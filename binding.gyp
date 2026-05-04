{
    "targets": [
        {
            "target_name": "uv-poll",
            "sources": [ "src/main.vibe.c" ],
            "cflags": [
                "-Werror",
                "-Wunused-variable",

                "-nostdlib",
                "-nodefaultlibs",
                "-ffreestanding"
            ],
            "ldflags": [
              "-nostdlib",
              "-nodefaultlibs"
            ],
            "libraries": []
        }
    ]
}
