# midi-mixer-cli

A CLI tool to help with the packaging and distribution of MIDI Mixer plugins.

```
Usage: midi-mixer [options] [command]

A CLI tool to help with the packaging and distribution of MIDI Mixer plugins.

Options:
  -V, --version   output the version number
  -h, --help      display help for command

Commands:
  pack [options]  Package a plugin ready for distribution.
  help [command]  display help for command
```

## Packaging plugins

Use the `midi-mixer pack` command to package a built plugin in to a `.midiMixerPlugin` file ready for distribution.

```
Usage: midi-mixer pack [options]

Package a plugin ready for distribution.

Options:
  -m --manifest <path>  target plugin.json file
  -h, --help            display help for command
```

```
> midi-mixer pack

  √ Finding plugin manifest
  √ Verifying manifest shape
  √ Verifying manifest targets
  √ Package
  √ Finalising
```

For a plugin with the name `foo` on version `1.0.0`, the plugin file generated would be called `foo-1.0.0.midiMixerPlugin`.
