module trains

go 1.26

require (
	github.com/MobilityData/gtfs-realtime-bindings/golang/gtfs v1.0.0
	google.golang.org/protobuf v1.26.0
)

require github.com/JeremyVun/flags/sdk/go v0.1.0

require github.com/JeremyVun/flags/server v0.1.0 // indirect

replace github.com/JeremyVun/flags/sdk/go => ../flags/sdk/go

replace github.com/JeremyVun/flags/server => ../flags/server
