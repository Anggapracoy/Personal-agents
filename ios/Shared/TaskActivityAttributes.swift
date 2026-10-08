import ActivityKit
import Foundation

struct TaskActivityAttributes: ActivityAttributes {
    struct ContentState: Codable, Hashable {
        let title: String
        let currentStep: String
        let estimate: String
        let completedSteps: Int
        let totalSteps: Int
    }

    let taskID: String
    let runID: String
}
