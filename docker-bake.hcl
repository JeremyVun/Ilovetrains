# Buildx bake target for ilovetrains. Mirrors the mortgage-calc/analytics
# layout in the infra repo's app repos.
#
#   See docs/operations/deploy.md for the numbered release command.
#   docker buildx bake --set ilovetrains.platform=linux/amd64 --load     # local single-arch
variable "REGISTRY"            { default = "registry.jeremyvun.com" }
variable "ILOVETRAINS_VERSION" { default = "latest" }
variable "GIT_REVISION"        { default = "dev" }

group "default" {
  targets = ["ilovetrains"]
}

target "ilovetrains" {
  context    = "."
  dockerfile = "Dockerfile"
  target     = "runtime"
  args = {
    GIT_REVISION = "${GIT_REVISION}"
  }
  platforms  = ["linux/amd64", "linux/arm64"]
  tags = [
    "${REGISTRY}/ilovetrains:${ILOVETRAINS_VERSION}",
    "${REGISTRY}/ilovetrains:latest"
  ]
}
