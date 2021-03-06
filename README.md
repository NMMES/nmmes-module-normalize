# NMMES-module-normalize

A normalization module for [nmmes-backend](https://github.com/NMMES/nmmes-backend).

## Features
- Normalize audio levels via the ffmpeg loudnorm audio filter.
- Set default audio stream based on language.
- Set default subtitle stream if an audio stream with the target language is not found.
- Create stream titles if they don't already exist.
- Automatically crop off black edges.
- Downscale video if larger than specified height.

## Installation

[![NPM](https://nodei.co/npm/nmmes-module-normalize.png?compact=true)](https://nodei.co/npm/nmmes-module-normalize/)

See https://github.com/NMMES/nmmes-cli/wiki/Modules for additional instructions.

## Options

The `--language` option sets the target language for normalization. The native-language option can parse [*ISO 639-1* and *ISO 639-2*](https://www.loc.gov/standards/iso639-2/php/code_list.php) (Ex: ja, jpn) Codes as well as the languages' full English name (Ex: Japanese, Russian, French).

Type: String<br>
Default: eng

---

The `--audio-levels` option normalizes audio stream levels with EBU R128 loudness normalization.

Type: Boolean<br>
Default: true

---

The `--audio-titles` option normalizes audio stream titles with the stream's language and format.

Type: Boolean<br>
Default: true

---

The `--subtitle-titles` option normalizes subtitle stream titles with the stream's language and format.

Type: Boolean<br>
Default: true

---

The `--force` option normalizes stream titles even if the stream already has a title.

Type: Boolean<br>
Default: false

---

The `--scale` option defines the height videos should be down scaled to. Videos will always maintain original aspect ratio. Videos will not be scaled up. Use 0 to disable this feature. [Examples: 720, 480].

Type: Number<br>
Default: 0

---

The `--autocrop-intervals` option attempts to crop off black bars on a video. Set to 0 to disable.

Type: Number<br>
Default: 12
