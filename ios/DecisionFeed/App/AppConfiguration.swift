import Foundation

struct AppConfiguration {
    let baseURL: URL
    let allowedHosts: Set<String>
    let wrapperVersion: Int
    let callbackScheme = "decisionfeed"

    static func load(bundle: Bundle = .main) -> AppConfiguration {
        guard
            let value = bundle.object(forInfoDictionaryKey: "DECISION_FEED_BASE_URL") as? String,
            let baseURL = URL(string: value),
            let host = baseURL.host?.lowercased()
        else {
            fatalError("DECISION_FEED_BASE_URL must be configured as an absolute URL.")
        }

        let configuredHosts = (bundle.object(forInfoDictionaryKey: "DECISION_FEED_ALLOWED_HOSTS") as? String ?? host)
            .split(separator: ",")
            .map { $0.trimmingCharacters(in: .whitespacesAndNewlines).lowercased() }
            .filter { !$0.isEmpty }
        let versionString = bundle.object(forInfoDictionaryKey: "DECISION_FEED_WRAPPER_VERSION") as? String ?? "1"
        return AppConfiguration(
            baseURL: baseURL,
            allowedHosts: Set(configuredHosts + [host]),
            wrapperVersion: Int(versionString) ?? 1
        )
    }
}

struct MobileWebConfiguration: Decodable {
    let minWrapperVersion: Int
    let maxWrapperVersion: Int
    let webBuildId: String
}

enum MobileCompatibility {
    static func supports(wrapperVersion: Int, configuration: MobileWebConfiguration) -> Bool {
        (configuration.minWrapperVersion...configuration.maxWrapperVersion).contains(wrapperVersion)
    }
}

enum WorkspaceLoadRecovery {
    enum Action: Equatable { case retry, fail }

    static let readyTimeoutNanoseconds: UInt64 = 15_000_000_000
    static let maximumAttempts = 2

    static func action(afterAttempt attempt: Int) -> Action {
        attempt < maximumAttempts ? .retry : .fail
    }
}
