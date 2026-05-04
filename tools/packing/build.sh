#!/bin/sh

set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
PROJECT_DIR=$(CDPATH= cd -- "$SCRIPT_DIR/../.." && pwd)
DOCKERFILE="$SCRIPT_DIR/docker/Dockerfile"
PACK_SCRIPT="$SCRIPT_DIR/pack-to-ts.ts"
GENERATED_DIR="$PROJECT_DIR/dist/lib/generated"
TMP_DIR="$SCRIPT_DIR/tmp"

BASE_ADDON_NAME="uv-poll"

build_native() {
	platform="$1"
	output_name="$2"

	docker buildx build \
		--platform "$platform" \
		--target artifact \
		--output "type=local,dest=$TMP_DIR" \
		-f "$DOCKERFILE" \
		"$PROJECT_DIR"

	mv "$TMP_DIR/$BASE_ADDON_NAME.node" "$TMP_DIR/$output_name"
}

pack_to_ts() {
	binary_path="$1"
	export_name="$2"
	output_path="$3"

	node "$PACK_SCRIPT" "$binary_path" "$export_name" > "$output_path"
}

rm -rf "$TMP_DIR"
mkdir -p "$TMP_DIR"
mkdir -p "$GENERATED_DIR"

build_native linux/amd64 $BASE_ADDON_NAME-x64.node
build_native linux/arm64 $BASE_ADDON_NAME-arm64.node

pack_to_ts "$TMP_DIR/$BASE_ADDON_NAME-x64.node" uvPollAddonX64 "$GENERATED_DIR/$BASE_ADDON_NAME-x64.js"
pack_to_ts "$TMP_DIR/$BASE_ADDON_NAME-arm64.node" uvPollAddonArm64 "$GENERATED_DIR/$BASE_ADDON_NAME-arm64.js"

rm -rf "$TMP_DIR"

echo "Done: generated TypeScript files in $GENERATED_DIR"
