# Copy into a temporary Godot project containing the exported folder.
# godot --headless --path <project> --script godot-validation.gd -- pixfit-meadow-atlas
extends SceneTree

func _initialize():
	var args = OS.get_cmdline_user_args()
	assert(args.size() == 1, "Pass the exported folder name after --")
	var folder = "res://" + args[0] + "/"
	var metadata = JSON.parse_string(FileAccess.get_file_as_string(folder + "atlas.json"))
	assert(metadata != null)
	assert(FileAccess.file_exists(folder + metadata.image), "Atlas JSON image is missing")
	var tileset = load(folder + "tileset.tres") as TileSet
	assert(tileset != null)
	assert(tileset.tile_size == Vector2i(int(metadata.tileWidth), int(metadata.tileHeight)))
	var atlas = tileset.get_source(0) as TileSetAtlasSource
	assert(atlas.get_tiles_count() == metadata.tiles.size())
	assert(not atlas.has_tiles_outside_texture())
	for tile in metadata.tiles:
		var coords = Vector2i(int(tile.x) / (int(metadata.tileWidth) + int(metadata.spacing)), int(tile.y) / (int(metadata.tileHeight) + int(metadata.spacing)))
		assert(atlas.has_tile(coords))
		assert(atlas.get_tile_size_in_atlas(coords) == Vector2i(int(tile.spanX), int(tile.spanY)))
	if metadata.projection == "orthogonal" and metadata.mode != "imported":
		assert(tileset.get_terrain_sets_count() == 1)
	var mapping = JSON.parse_string(FileAccess.get_file_as_string(folder + "tile-ids.json"))
	for id in metadata.animations:
		var animation = metadata.animations[id]
		var source = tileset.get_source(int(mapping.tiles[id].source)) as TileSetAtlasSource
		assert(source.get_tile_animation_frames_count(Vector2i.ZERO) == animation.frames.size())
		assert(is_equal_approx(source.get_tile_animation_speed(Vector2i.ZERO), animation.fps))
		assert(not source.has_tiles_outside_texture())
	print("PIXFIT GODOT VALIDATION PASSED: %d tiles, all rectangles, image references, and %d animations" % [metadata.tiles.size(), metadata.animations.size()])
	quit(0)
