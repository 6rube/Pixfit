# Run after importing a project containing a Pixfit tileset collection export.
# godot --headless --path <project> --script <this file> -- pixfit-world-collection
extends SceneTree

func _initialize():
	var args = OS.get_cmdline_user_args()
	assert(args.size() == 1)
	var folder = "res://" + args[0] + "/"
	var metadata = JSON.parse_string(FileAccess.get_file_as_string(folder + "collection.json"))
	var mapping = JSON.parse_string(FileAccess.get_file_as_string(folder + "tile-ids.json"))
	var tileset = load(folder + "tileset.tres") as TileSet
	assert(tileset != null)
	var expected_sources = metadata.terrains.size()
	for terrain in metadata.terrains:
		assert(FileAccess.file_exists(folder + terrain.image))
		expected_sources += terrain.animations.size()
		var ids = mapping.terrains[terrain.id]
		for tile in terrain.tiles:
			var address = ids.tiles[str(int(tile.id))]
			var source = tileset.get_source(int(address.source)) as TileSetAtlasSource
			var coords = Vector2i(int(address.atlas[0]), int(address.atlas[1]))
			assert(source.has_tile(coords))
			assert(not source.has_tiles_outside_texture())
			if ids.has("terrain"):
				var data = source.get_tile_data(coords, 0)
				assert(data.terrain_set == int(ids.terrain.set))
				assert(data.terrain == int(ids.terrain.inner) or data.terrain == int(ids.terrain.outer))
		for id in terrain.animations:
			var address = ids.tiles[id]
			var source = tileset.get_source(int(address.source)) as TileSetAtlasSource
			assert(source.get_tile_animation_frames_count(Vector2i.ZERO) == terrain.animations[id].frames.size())
	assert(tileset.get_source_count() == expected_sources)
	print("PIXFIT GODOT COLLECTION VALIDATION PASSED: %d sources, %d terrain sets" % [expected_sources, tileset.get_terrain_sets_count()])
	quit(0)
