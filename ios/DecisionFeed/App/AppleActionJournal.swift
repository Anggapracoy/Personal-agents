import Foundation

/// Persist before a device mutation. A claimed action without a result has an
/// uncertain outcome after a crash and must never be blindly executed again.
struct AppleActionJournal {
    let directory: URL
    init(owner: String, root: URL? = nil) throws {
        try self.init(ownerKey: AppleConnections.ownerKey(owner), root: root)
    }
    init(ownerKey: String, root: URL? = nil) throws {
        guard ownerKey.range(of: "^[a-f0-9]{64}$", options: .regularExpression) != nil else { throw AppleConnectionFailure("Invalid account.") }
        let base = try root ?? FileManager.default.url(for: .applicationSupportDirectory, in: .userDomainMask, appropriateFor: nil, create: true)
        directory = base.appendingPathComponent("AppleActionReceipts").appendingPathComponent(ownerKey)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true, attributes: [.protectionKey: FileProtectionType.completeUntilFirstUserAuthentication])
        var excluded = directory; var values = URLResourceValues(); values.isExcludedFromBackup = true; try excluded.setResourceValues(values)
    }
    func url(_ actionID: String) throws -> URL {
        guard UUID(uuidString: actionID) != nil else { throw AppleConnectionFailure("Invalid action identifier.") }
        return directory.appendingPathComponent(actionID + ".json")
    }
    func read(_ actionID: String) throws -> [String: Any]? {
        let target = try url(actionID)
        guard FileManager.default.fileExists(atPath: target.path) else { return nil }
        return try JSONSerialization.jsonObject(with: Data(contentsOf: target)) as? [String: Any]
    }
    func save(_ actionID: String, _ value: [String: Any]) throws {
        let data = try JSONSerialization.data(withJSONObject: value)
        try data.write(to: url(actionID), options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
    }
    func clear() throws { try FileManager.default.removeItem(at: directory) }
}

/// Claims, runs and returns one iPhone action. The open app and background wake-ups share this
/// so a crash between the two can only ever finish the saved receipt, never run the action twice.
@MainActor
enum AppleActionRunner {
    typealias Fetch = (_ path: String, _ method: String, _ body: Data?) async throws -> Data

    static func run(runID: String, actionID: String, journal: AppleActionJournal, expectedOwner: String?, expectedOwnerKey: String? = nil, onlyOperation: String? = nil,
                    connections: AppleConnections, isCurrent: () -> Bool = { true }, fetch: Fetch) async throws -> Data {
        var receipt = try journal.read(actionID)
        if receipt == nil {
            let claimBody = try JSONSerialization.data(withJSONObject: ["phase": "claim", "actionId": actionID])
            let claimData = try await fetch("api/runs/\(runID)/apple", "POST", claimBody)
            guard let claim = try JSONSerialization.jsonObject(with: claimData) as? [String: Any],
                  let owner = claim["owner"] as? String, expectedOwner == nil || owner == expectedOwner,
                  expectedOwnerKey == nil || AppleConnections.ownerKey(owner) == expectedOwnerKey,
                  let operation = claim["operation"] as? String, let parameters = claim["parameters"] as? [String: Any],
                  let token = claim["token"] as? String,
                  isCurrent() else { throw AppleConnectionFailure("Your account changed. Reopen this conversation.") }
            receipt = ["token": token, "runId": runID]
            try journal.save(actionID, receipt!)
            var result: [String: Any]
            if let onlyOperation, onlyOperation != operation {
                result = ["ok": false, "retryable": true, "error": "Open Dash on the iPhone to finish this step."]
            } else {
                do {
                    var executionParameters = parameters
                    if operation == "photos.save" {
                        guard let artifactID = parameters["artifactId"] as? String, UUID(uuidString: artifactID) != nil else { throw AppleConnectionFailure("A valid image artifact is required.") }
                        let imageData = try await fetch("api/runs/\(runID)/artifacts/\(artifactID)", "GET", nil)
                        guard imageData.count <= 10_000_000 else { throw AppleConnectionFailure("Choose an image smaller than 10 MB.") }
                        executionParameters["imageData"] = imageData
                    }
                    var value = try await connections.execute(owner: owner, operation: operation, parameters: executionParameters, actionID: actionID)
                    if value["ok"] == nil { value["ok"] = true }
                    value["observedAt"] = ISO8601DateFormatter().string(from: Date())
                    result = value
                } catch {
                    result = ["ok": false, "retryable": (error as? AppleConnectionFailure)?.retryable ?? false, "error": (error as? AppleConnectionFailure)?.message ?? "Apple could not complete this action. Check access and availability on your iPhone before retrying."]
                    if operation.hasPrefix("health."), !(error is AppleConnectionFailure) {
                        let native = error as NSError
                        result["errorDomain"] = native.domain
                        result["errorCode"] = native.code
                        result["error"] = "Health could not complete this query. This does not establish that read permission was denied. Native error: \(native.domain) (\(native.code))."
                    }
                }
            }
            result["connections"] = connections.snapshot(owner)
            receipt?["result"] = result
            try journal.save(actionID, receipt!)
        }
        guard var saved = receipt, let token = saved["token"] as? String, saved["runId"] as? String == runID, isCurrent() else { throw AppleConnectionFailure("Reopen this conversation with its original account.") }
        if saved["result"] == nil {
            saved["result"] = ["ok": false, "outcomeUnknown": true, "error": "The iPhone stopped before saving a result. The action may have happened. Verify the source before creating a new action; do not automatically repeat it."]
            try journal.save(actionID, saved)
        }
        let body = try JSONSerialization.data(withJSONObject: ["phase": "complete", "actionId": actionID, "token": token, "result": saved["result"]!])
        let data = try await fetch("api/runs/\(runID)/apple", "POST", body)
        // Keep the minimal receipt for replay; source content is durable on the server now.
        try? journal.save(actionID, ["token": token, "runId": runID, "result": ["ok": true, "alreadyReturned": true]])
        return data
    }
}
