module trains

go 1.26

require (
	github.com/JeremyVun/flags/sdk/go v0.0.0
	github.com/MobilityData/gtfs-realtime-bindings/golang/gtfs v1.0.0
	google.golang.org/protobuf v1.26.0
)

require github.com/JeremyVun/flags/server v0.1.0 // indirect

// Owner-approved vendored snapshot; provenance lives in third_party/flags/.
replace github.com/JeremyVun/flags/sdk/go => ./third_party/flags/sdk/go

replace github.com/JeremyVun/flags/server => ./third_party/flags/server
