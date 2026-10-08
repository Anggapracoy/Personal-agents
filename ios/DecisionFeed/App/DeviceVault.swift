import CryptoKit
import LocalAuthentication
import Security

enum DeviceVaultError: LocalizedError {
    case invalidPayload
    case unavailable
    case keychain(OSStatus)
    case encryption

    var errorDescription: String? {
        switch self {
        case .invalidPayload: "The secure item was incomplete."
        case .unavailable: "That item is not saved on this iPhone."
        case .keychain(let status): "The iPhone vault could not be opened (\(status))."
        case .encryption: "The one-time secure handoff could not be created."
        }
    }
}

struct DeviceVaultSecret: Codable, Equatable {
    let kind: String
    var username: String?
    var password: String?
    var cardholderName: String?
    var cardNumber: String?
    var expiryMonth: String?
    var expiryYear: String?
    var billingPostalCode: String?
    var securityCode: String?

    static func login(username: String, password: String) throws -> Self {
        guard !username.isEmpty, !password.isEmpty else { throw DeviceVaultError.invalidPayload }
        return Self(kind: "login", username: username, password: password)
    }

    static func payment(
        cardholderName: String,
        cardNumber: String,
        expiryMonth: String,
        expiryYear: String,
        billingPostalCode: String
    ) throws -> Self {
        let digits = cardNumber.filter(\.isNumber)
        guard !cardholderName.isEmpty, (12...19).contains(digits.count), !expiryMonth.isEmpty, !expiryYear.isEmpty else {
            throw DeviceVaultError.invalidPayload
        }
        return Self(
            kind: "payment_card",
            cardholderName: cardholderName,
            cardNumber: digits,
            expiryMonth: expiryMonth.count == 1 ? "0\(expiryMonth)" : expiryMonth,
            expiryYear: expiryYear,
            billingPostalCode: billingPostalCode.isEmpty ? nil : billingPostalCode
        )
    }
}

struct DeviceVaultEnvelope: Encodable, Equatable {
    let encryptedKey: String
    let sealed: String
}

final class DeviceVault {
    private let service = "com.example.dash.device-vault.v1"

    func save(ownerEmail: String, itemID: String, secret: DeviceVaultSecret) throws {
        let data = try JSONEncoder().encode(secret)
        var error: Unmanaged<CFError>?
        guard let access = SecAccessControlCreateWithFlags(
            nil,
            kSecAttrAccessibleWhenUnlockedThisDeviceOnly,
            [.userPresence],
            &error
        ) else { throw error?.takeRetainedValue() ?? DeviceVaultError.unavailable }
        let account = account(ownerEmail: ownerEmail, itemID: itemID)
        let matchQuery: [String: Any] = baseQuery(account: account).merging([
            kSecUseDataProtectionKeychain as String: true,
        ]) { _, new in new }
        let attributes: [String: Any] = [
            kSecValueData as String: data,
            kSecAttrAccessControl as String: access,
        ]
        let updateStatus = SecItemUpdate(matchQuery as CFDictionary, attributes as CFDictionary)
        if updateStatus == errSecSuccess { return }
        guard updateStatus == errSecItemNotFound else { throw DeviceVaultError.keychain(updateStatus) }
        let addQuery = matchQuery.merging(attributes) { _, new in new }
        let status = SecItemAdd(addQuery as CFDictionary, nil)
        guard status == errSecSuccess else { throw DeviceVaultError.keychain(status) }
    }

    func read(ownerEmail: String, itemID: String, reason: String) async throws -> DeviceVaultSecret {
        let context = LAContext()
        // Start the system prompt immediately and suspend rather than blocking
        // WebKit's main thread while the user authenticates. Reuse this exact
        // context for the keychain read, so it does not prompt a second time.
        try await context.evaluatePolicy(.deviceOwnerAuthentication, localizedReason: reason)
        let query: [String: Any] = baseQuery(account: account(ownerEmail: ownerEmail, itemID: itemID)).merging([
            kSecReturnData as String: true,
            kSecMatchLimit as String: kSecMatchLimitOne,
            kSecUseAuthenticationContext as String: context,
            kSecUseDataProtectionKeychain as String: true,
        ]) { _, new in new }
        var result: CFTypeRef?
        let status = SecItemCopyMatching(query as CFDictionary, &result)
        if status == errSecItemNotFound { throw DeviceVaultError.unavailable }
        guard status == errSecSuccess, let data = result as? Data else { throw DeviceVaultError.keychain(status) }
        return try JSONDecoder().decode(DeviceVaultSecret.self, from: data)
    }

    func delete(ownerEmail: String, itemID: String) throws {
        let status = SecItemDelete(baseQuery(account: account(ownerEmail: ownerEmail, itemID: itemID)) as CFDictionary)
        guard status == errSecSuccess || status == errSecItemNotFound else { throw DeviceVaultError.keychain(status) }
    }

    func deleteAll(ownerEmail: String) throws {
        let ownerPrefix = "\(ownerEmail.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()):"
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecReturnAttributes as String: true,
            kSecMatchLimit as String: kSecMatchLimitAll,
            kSecUseDataProtectionKeychain as String: true,
        ]
        var result: CFTypeRef?
        let status = SecItemCopyMatching(query as CFDictionary, &result)
        if status == errSecItemNotFound { return }
        guard status == errSecSuccess else { throw DeviceVaultError.keychain(status) }
        let items = result as? [[String: Any]] ?? []
        for item in items {
            guard let account = item[kSecAttrAccount as String] as? String,
                  account.hasPrefix(ownerPrefix) else { continue }
            let deleteStatus = SecItemDelete(baseQuery(account: account) as CFDictionary)
            guard deleteStatus == errSecSuccess || deleteStatus == errSecItemNotFound else {
                throw DeviceVaultError.keychain(deleteStatus)
            }
        }
    }

    private func account(ownerEmail: String, itemID: String) -> String {
        "\(ownerEmail.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()):\(itemID)"
    }

    private func baseQuery(account: String) -> [String: Any] {
        [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
        ]
    }
}

enum DeviceVaultEncryption {
    static func seal(_ secret: DeviceVaultSecret, recipientPublicKey: String) throws -> DeviceVaultEnvelope {
        guard let keyData = Data(base64Encoded: recipientPublicKey) else { throw DeviceVaultError.encryption }
        let attributes: [String: Any] = [
            kSecAttrKeyType as String: kSecAttrKeyTypeRSA,
            kSecAttrKeyClass as String: kSecAttrKeyClassPublic,
            kSecAttrKeySizeInBits as String: 3072,
        ]
        var keyError: Unmanaged<CFError>?
        guard let publicKey = SecKeyCreateWithData(keyData as CFData, attributes as CFDictionary, &keyError) else {
            throw keyError?.takeRetainedValue() ?? DeviceVaultError.encryption
        }
        let symmetric = SymmetricKey(size: .bits256)
        let clear = try JSONEncoder().encode(secret)
        let sealed = try AES.GCM.seal(clear, using: symmetric)
        guard let combined = sealed.combined else { throw DeviceVaultError.encryption }
        let rawKey = symmetric.withUnsafeBytes { Data($0) }
        guard SecKeyIsAlgorithmSupported(publicKey, .encrypt, .rsaEncryptionOAEPSHA256) else { throw DeviceVaultError.encryption }
        var encryptionError: Unmanaged<CFError>?
        guard let wrapped = SecKeyCreateEncryptedData(publicKey, .rsaEncryptionOAEPSHA256, rawKey as CFData, &encryptionError) else {
            throw encryptionError?.takeRetainedValue() ?? DeviceVaultError.encryption
        }
        return DeviceVaultEnvelope(
            encryptedKey: (wrapped as Data).base64EncodedString(),
            sealed: combined.base64EncodedString()
        )
    }
}
