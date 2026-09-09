// Command tfnsw-stub replays captured TfNSW responses so the server, the
// checked-in regression suite and a fixer agent all run with no API key and no
// upstream quota. It serves the fixtures verbatim; each route records the
// anchor instant a case must pin its browser clock to.
//
// Usage:
//
//	go run ./tools/tfnsw-stub --port 8420 --fixtures tools/fixtures \
//	  --routes tools/fixtures/stub-routes.json
//	go run ./tools/tfnsw-stub --routes tools/fixtures/stub-routes.json --list-anchors
package main

import (
	"flag"
	"fmt"
	"log"
	"net"
	"net/http"
	"os"
)

func main() {
	port := flag.Int("port", 8420, "listen port; 0 picks a free one")
	fixtures := flag.String("fixtures", "tools/fixtures", "directory the fixtures are read from")
	routes := flag.String("routes", "tools/fixtures/stub-routes.json", "route table")
	listAnchors := flag.Bool("list-anchors", false, "print path, query, fixture and anchor for every route, then exit")
	flag.Parse()

	if err := run(*port, *fixtures, *routes, *listAnchors); err != nil {
		fmt.Fprintf(os.Stderr, "tfnsw-stub: %v\n", err)
		os.Exit(1)
	}
}

func run(port int, fixturesDir, routesPath string, listAnchors bool) error {
	table, err := loadRoutes(routesPath, fixturesDir)
	if err != nil {
		return err
	}
	if listAnchors {
		return writeAnchors(os.Stdout, table)
	}
	logger := log.New(os.Stderr, "tfnsw-stub ", log.LstdFlags)
	listener, err := net.Listen("tcp", net.JoinHostPort("127.0.0.1", fmt.Sprint(port)))
	if err != nil {
		return err
	}
	logger.Printf("listening on http://%s with %d routes from %s", listener.Addr(), len(table), routesPath)
	return http.Serve(listener, &stub{routes: table, dir: fixturesDir, logf: logger.Printf})
}
