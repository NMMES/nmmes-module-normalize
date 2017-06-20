# NMMES-module-normalize

A normalization module for nmmes-backend.

## Dependencies

- [nmmes-backend](https://github.com/NMMES/nmmes-backend) - Required in order to run this module.

## Usage

You will need to install the encoder module (`nmmes-module-encoder`) for this example.

```javascript
import {Video, Logger} from 'nmmes-backend';
import encoder from 'nmmes-module-encoder';
import normalize from 'nmmes-module-normalize';

let video = new Video({
    input: {
        path: '/home/user/videos/video.mp4'
    },
    output: {
        path: '/home/user/videos/encoded-video.mkv'
    },
    modules: [new normalize(), new encoder({
        defaults: {
            video: {
                'c:{POS}': 'libx265'
            }
        }
    })]
});

video.on('stop', function(err) {
    if (err)
        return Logger.error('Error encoding video', err);

    Logger.log('Video encoding complete.');
});

video.start();
```

## Options

You may pass the normalize class an optional options object.

```javascript
new normalize({
    normalizeAudioTitles: true, // Should we normalize audio stream titles
    normalizeSubtitleTitles: true,  // Should we normalize subtitle stream titles
    setDefaultAudio: true, // Should we set the default audio track
    setDefaultSubtitle: true, // Should we set the default subtitle track
    force: false, // Should titles be normalized even if one already exists
    language: 'eng' // Language to normalize against (en, eng, English all mean the same thing)
});
```
