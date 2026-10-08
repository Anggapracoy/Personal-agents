import CoreLocation
import CoreMotion
import HealthKit
import MapKit
import WeatherKit

extension AppleConnections {
    nonisolated static func healthQuantityResult(_ value: Double?, error: Error?) throws -> Double? {
        if let error {
            let native = error as NSError
            if native.domain == HKErrorDomain && native.code == HKError.Code.errorNoData.rawValue { return nil }
            throw error
        }
        return value
    }

    func healthSamples(type: HKSampleType, start: Date, end: Date, limit: Int) async throws -> [HKSample] {
        try await withCheckedThrowingContinuation { continuation in
            let predicate = HKQuery.predicateForSamples(withStart: start, end: end)
            health.execute(HKSampleQuery(sampleType: type, predicate: predicate, limit: limit, sortDescriptors: [NSSortDescriptor(key: HKSampleSortIdentifierStartDate, ascending: false)]) { _, values, error in
                if let error { continuation.resume(throwing: error) } else { continuation.resume(returning: values ?? []) }
            })
        }
    }
    func healthQuantity(_ identifier: HKQuantityTypeIdentifier, unit: HKUnit, start: Date, end: Date) async throws -> Double? {
        try await withCheckedThrowingContinuation { continuation in
            let query = HKStatisticsQuery(quantityType: HKQuantityType(identifier), quantitySamplePredicate: HKQuery.predicateForSamples(withStart: start, end: end, options: .strictStartDate), options: .cumulativeSum) { _, value, error in
                do { continuation.resume(returning: try Self.healthQuantityResult(value?.sumQuantity()?.doubleValue(for: unit), error: error)) }
                catch { continuation.resume(throwing: error) }
            }
            health.execute(query)
        }
    }
    static func mergedDuration(_ intervals: [(Date, Date)]) -> TimeInterval {
        let sorted = intervals.filter { $0.1 > $0.0 }.sorted { $0.0 < $1.0 }
        guard var current = sorted.first else { return 0 }
        var total: TimeInterval = 0
        for interval in sorted.dropFirst() {
            if interval.0 <= current.1 { current.1 = max(current.1, interval.1) }
            else { total += current.1.timeIntervalSince(current.0); current = interval }
        }
        return total + current.1.timeIntervalSince(current.0)
    }
    func healthAction(_ operation: String, _ p: [String: Any]) async throws -> [String: Any] {
        if operation == "health.logWater" {
            guard let amount = p["milliliters"] as? Double, amount > 0, amount <= 10_000 else { throw AppleConnectionFailure("Water must be between 0 and 10,000 milliliters.") }
            let type = HKQuantityType(.dietaryWater)
            guard health.authorizationStatus(for: type) == .sharingAuthorized else { throw AppleConnectionFailure("Allow Dash to write water intake in Health first.") }
            let date = try p["date"] is String ? Self.date(p["date"]) : Date()
            let sample = HKQuantitySample(type: type, quantity: HKQuantity(unit: .literUnit(with: .milli), doubleValue: amount), start: date, end: date)
            try await health.save(sample)
            return ["id": sample.uuid.uuidString, "milliliters": amount, "date": ISO8601DateFormatter().string(from: date), "saved": true]
        }
        let (start, end) = try Self.interval(p)
        if operation == "health.workouts" {
            let samples = try await healthSamples(type: .workoutType(), start: start, end: end, limit: Self.limit(p) + 1)
            let values = samples.compactMap { $0 as? HKWorkout }.prefix(Self.limit(p)).map { workout -> [String: Any] in
                ["id": workout.uuid.uuidString, "activityType": workout.workoutActivityType.rawValue, "start": ISO8601DateFormatter().string(from: workout.startDate), "end": ISO8601DateFormatter().string(from: workout.endDate), "durationMinutes": workout.duration / 60, "source": workout.sourceRevision.source.name]
            }
            return ["workouts": values, "hasMore": samples.count > Self.limit(p), "note": "Only permitted samples are returned. Empty results may mean no read permission."]
        }
        guard operation == "health.summary" else { throw AppleConnectionFailure("Unsupported Health action.") }
        async let steps = healthQuantity(.stepCount, unit: .count(), start: start, end: end)
        async let energy = healthQuantity(.activeEnergyBurned, unit: .kilocalorie(), start: start, end: end)
        async let water = healthQuantity(.dietaryWater, unit: .literUnit(with: .milli), start: start, end: end)
        let sleep = try await healthSamples(type: HKCategoryType(.sleepAnalysis), start: start, end: end, limit: 10_000).compactMap { $0 as? HKCategorySample }.filter { HKCategoryValueSleepAnalysis.allAsleepValues.contains(HKCategoryValueSleepAnalysis(rawValue: $0.value) ?? .inBed) }
        let duration = Self.mergedDuration(sleep.map { (max($0.startDate, start), min($0.endDate, end)) })
        return ["steps": try await steps as Any? ?? NSNull(), "activeKilocalories": try await energy as Any? ?? NSNull(), "waterMilliliters": try await water as Any? ?? NSNull(), "sleepMinutes": sleep.isEmpty ? NSNull() : duration / 60, "start": ISO8601DateFormatter().string(from: start), "end": ISO8601DateFormatter().string(from: end), "note": "Missing data can mean denied read access. Do not infer inactivity or full permission. Sleep intervals are merged to avoid duplicate sources."]
    }
    func stepData(from start: Date, to end: Date) async throws -> CMPedometerData {
        try await withCheckedThrowingContinuation { continuation in
            pedometer.queryPedometerData(from: start, to: end) { data, error in
                if let data { continuation.resume(returning: data) }
                else { continuation.resume(throwing: error ?? AppleConnectionFailure("Motion data is unavailable.")) }
            }
        }
    }
    func motionAction(_ p: [String: Any]) async throws -> [String: Any] {
        let (start, end) = try Self.interval(p)
        guard start >= Date().addingTimeInterval(-7 * 86400), end <= Date().addingTimeInterval(60) else { throw AppleConnectionFailure("Motion history is available for the past seven days. Use Health for older steps.") }
        let data = try await stepData(from: start, to: end)
        var result: [String: Any] = ["steps": data.numberOfSteps, "distanceMeters": data.distance ?? NSNull(), "floorsAscended": data.floorsAscended ?? NSNull(), "start": ISO8601DateFormatter().string(from: data.startDate), "end": ISO8601DateFormatter().string(from: data.endDate)]
        if CMMotionActivityManager.isActivityAvailable() {
            let activities: [CMMotionActivity] = try await withCheckedThrowingContinuation { continuation in
                activity.queryActivityStarting(from: start, to: end, to: .main) { values, error in
                    if let error { continuation.resume(throwing: error) } else { continuation.resume(returning: values ?? []) }
                }
            }
            result["activities"] = activities.suffix(100).map { value in ["start": ISO8601DateFormatter().string(from: value.startDate), "walking": value.walking, "running": value.running, "cycling": value.cycling, "automotive": value.automotive, "stationary": value.stationary, "confidence": value.confidence.rawValue] as [String: Any] }
            result["activitiesTruncated"] = activities.count > 100
        }
        return result
    }
    static func coordinate(_ p: [String: Any], prefix: String = "") throws -> CLLocationCoordinate2D {
        let latKey = prefix.isEmpty ? "latitude" : "\(prefix)Latitude"
        let lonKey = prefix.isEmpty ? "longitude" : "\(prefix)Longitude"
        guard let lat = p[latKey] as? Double, let lon = p[lonKey] as? Double, lat.isFinite, lon.isFinite, abs(lat) <= 90, abs(lon) <= 180 else { throw AppleConnectionFailure("Valid latitude and longitude are required.") }
        return CLLocationCoordinate2D(latitude: lat, longitude: lon)
    }
    func mapsAction(_ operation: String, _ p: [String: Any]) async throws -> [String: Any] {
        if operation == "maps.search" {
            let request = MKLocalSearch.Request(); request.naturalLanguageQuery = try Self.string(p, "query")
            if p["latitude"] != nil && !(p["latitude"] is NSNull) { request.region = MKCoordinateRegion(center: try Self.coordinate(p), latitudinalMeters: 20_000, longitudinalMeters: 20_000) }
            let response = try await MKLocalSearch(request: request).start()
            return ["places": response.mapItems.prefix(Self.limit(p)).map { item in
                ["name": item.name ?? "Place", "address": item.placemark.title ?? "", "latitude": item.placemark.coordinate.latitude, "longitude": item.placemark.coordinate.longitude, "phone": item.phoneNumber ?? "", "website": item.url?.absoluteString ?? "", "mapsURL": "https://maps.apple.com/?ll=\(item.placemark.coordinate.latitude),\(item.placemark.coordinate.longitude)"] as [String: Any]
            }, "attribution": "Apple Maps"]
        }
        guard operation == "maps.directions" else { throw AppleConnectionFailure("Unsupported Maps action.") }
        let request = MKDirections.Request()
        request.source = MKMapItem(placemark: MKPlacemark(coordinate: try Self.coordinate(p)))
        request.destination = MKMapItem(placemark: MKPlacemark(coordinate: try Self.coordinate(p, prefix: "destination")))
        let transport = (p["transport"] as? String) ?? "automobile"
        guard ["walking", "automobile"].contains(transport) else { throw AppleConnectionFailure("Choose walking or automobile directions.") }
        request.transportType = transport == "walking" ? .walking : .automobile
        let response = try await MKDirections(request: request).calculate()
        return ["routes": response.routes.prefix(3).map { route in ["name": route.name, "distanceMeters": route.distance, "travelMinutes": route.expectedTravelTime / 60, "steps": route.steps.map { ["instruction": $0.instructions, "distanceMeters": $0.distance] as [String: Any] }] as [String: Any] }, "attribution": "Apple Maps"]
    }
    func weatherAction(_ p: [String: Any]) async throws -> [String: Any] {
        let coordinate = try Self.coordinate(p)
        let service = WeatherService.shared
        async let attribution = service.attribution
        let weather = try await service.weather(for: CLLocation(latitude: coordinate.latitude, longitude: coordinate.longitude))
        let legal = try await attribution
        return ["current": ["condition": weather.currentWeather.condition.description, "temperatureCelsius": weather.currentWeather.temperature.converted(to: .celsius).value, "feelsLikeCelsius": weather.currentWeather.apparentTemperature.converted(to: .celsius).value, "humidity": weather.currentWeather.humidity, "observedAt": ISO8601DateFormatter().string(from: weather.currentWeather.date)], "daily": weather.dailyForecast.forecast.prefix(7).map { day in ["date": ISO8601DateFormatter().string(from: day.date), "condition": day.condition.description, "highCelsius": day.highTemperature.converted(to: .celsius).value, "lowCelsius": day.lowTemperature.converted(to: .celsius).value, "precipitationChance": day.precipitationChance] as [String: Any] }, "hourly": weather.hourlyForecast.forecast.prefix(24).map { hour in ["date": ISO8601DateFormatter().string(from: hour.date), "temperatureCelsius": hour.temperature.converted(to: .celsius).value, "condition": hour.condition.description, "precipitationChance": hour.precipitationChance] as [String: Any] }, "attribution": ["name": "Apple Weather", "legalURL": legal.legalPageURL.absoluteString, "markLightURL": legal.combinedMarkLightURL.absoluteString, "markDarkURL": legal.combinedMarkDarkURL.absoluteString], "displayRequirement": "Include the Apple Weather attribution mark and legalURL with this forecast."]
    }
}
