'use strict';

const nmmes = require('nmmes-backend');
const Logger = nmmes.Logger;
const chalk = require('chalk');
const languages = require('./languages.json');
const ffmpeg = require('fluent-ffmpeg');
const onDeath = require('death');

module.exports = class Normalize extends nmmes.Module {
    constructor(args) {
        super(require('./package.json'));

        this.options = Object.assign(nmmes.Module.defaults(Normalize), args);

        this.options.language = normalizeLanguage(this.options.language);
    }
    init() {
        let _self = this;
        return new Promise(function(resolve, reject) {
            if (_self.options.language === 'Unknown') {
                reject(new Error('Invalid language parameter provided. Use ISO 639-1 Code, ISO 639-2 Code, or full english name.'))
            } else {
                resolve();
            }
        });
    }
    normalizeStreamTitle(metadata) {
        const language = getNormalizedStreamLanguage(metadata);
        const codecName = metadata.codec_name.toUpperCase();

        let title;
        if (metadata.codec_type === 'audio') {
            const channelsFormated = formatAudioChannels(metadata.channels);
            title = `${language} (${codecName}${channelsFormated ? ' '+channelsFormated: ''})`;
        } else {
            title = `${language} (${codecName})`;
        }
        return title;
    }
    normalizeAudioLevel(stream) {
        const _self = this;
        const video = this.video;
        const loudnormRegex = /\[Parsed_loudnorm_.+?\] \n(\{(.|\n)+?\})/;

        return new Promise((resolve, reject) => {
            ffmpeg(video.input.path, {
                    niceness: 19
                })
                .output('-')
                .outputOptions('-map', stream.map)
                .audioFilters([{
                    filter: 'loudnorm',
                    options: 'print_format=json'
                }])
                .format('null')
                .on('start', (cmd) => {
                    Logger.debug(`Normalizing audio stream ${stream.map}.`);
                    Logger.trace('Query:', cmd);
                })
                .on('error', (err, stdout, stderr) => {
                    return reject(err);
                })
                .on('end', (stdout, stderr) => {
                    let matches = stderr.match(loudnormRegex);

                    if (matches.length < 2)
                        return reject(new Error("Invalid loudnorm output"));
                    const json = JSON.parse(matches[1].replace(/\r?\n|\r|\t/g, " "));
                    Logger.trace('Measured loudnorm:', json);
                    return resolve(`loudnorm=measured_I=${json.input_i}:measured_LRA=${json.input_lra}:measured_TP=${json.input_tp}:measured_thresh=${json.input_thresh}`);
                    delete _self.progress[stream.map];
                })
                .on('progress', function(progress) {
                    let precent = progress.percent ? progress.percent.toFixed(1) : '~ ';
                    _self.progress[stream.map] = chalk.yellow(precent + '%');
                })
                .run();
        });
    }
    async normalizeStream(pos, map) {
        const video = this.video;
        const options = this.options;
        const index = Object.keys(map.streams)[pos];
        const stream = map.streams[index];
        const input = stream.map.split(':')[0];
        const metadata = video.input.metadata[input].streams[index];
        let filter_complex_source = `[${input}:${index}]`;

        let changes = {
            ['metadata:s:' + pos]: [],
            filter_complex: []
        };

        Logger.trace(`Processing ${metadata.codec_type} stream [${chalk.bold(stream.map)}] with language ${chalk.bold(getNormalizedStreamLanguage(metadata))}.`);

        switch (metadata.codec_type) {
            case 'audio':
                {

                    // Set normalized titles
                    if (options['audio-titles'] && (!getStreamTitle(metadata) || options.force)) {
                        const title = this.normalizeStreamTitle(metadata);
                        changes['metadata:s:' + pos].push(`title=${title}`);
                        Logger.log(`Set title for ${metadata.codec_type} stream ${chalk.bold(getStreamTitle(metadata))} [${chalk.bold(stream.map)}] to ${chalk.bold(title)}.`);
                    }

                    // Attempt to set a default audio track
                    if (options.language && options.language !== 'Unknown') {
                        if (options.language === getNormalizedStreamLanguage(metadata) && !this.defaultAudioSet) {
                            changes['metadata:s:' + pos].push('DISPOSITION:default=1');
                            Logger.log(`Set default audio stream to [${chalk.bold(stream.map)}].`);
                            this.defaultAudioSet = true;
                        } else {
                            changes['metadata:s:' + pos].push('DISPOSITION:default=0');
                        }
                    }

                    // Normalize audio level
                    if (options['audio-level']) {
                        changes.filter_complex[changes.filter_complex.length - 1] += filter_complex_source;
                        // TODO: Measure in parallel
                        changes.filter_complex.push(`${filter_complex_source}${await this.normalizeAudioLevel(stream)}`);
                        filter_complex_source = `[${input}-${index}-loudnorm]`;
                        changes['c:' + pos] = 'aac';
                        changes[`q:` + pos] = 2;
                    }

                    break;
                }
            case 'subtitle':
                {

                    // Set normalized titles
                    if (options['subtitle-titles'] && (!getStreamTitle(metadata) || options.force)) {
                        const title = this.normalizeStreamTitle(metadata);
                        changes['metadata:s:' + pos].push(`title=${title}`);
                        Logger.log(`Set title for ${metadata.codec_type} stream ${chalk.bold(getStreamTitle(metadata))} [${chalk.bold(stream.map)}] to ${chalk.bold(title)}`);
                    }

                    break;
                }
            case 'video':
                {

                    if (options['autocrop-intervals']) {
                        const intervalLength = video.input.metadata[input].format.duration / (options['autocrop-intervals'] + 1);
                        Logger.debug(`Detecting possible crop for video stream ${chalk.bold(this.normalizeStreamTitle(metadata))} [${chalk.bold(stream.map)}]`);

                        let promises = [];
                        for (let i = options['autocrop-intervals']; i > 0; i--) {
                            promises.push(this.detectCropAtInterval(i * intervalLength, stream.map));
                        }

                        let crop = await Promise.all(promises).then(measureCrop);

                        Logger.trace(`Crop detected: ${crop.w}x${crop.h} (y:${crop.y}, x:${crop.x})`);
                        if (crop.x > 0 || crop.y > 0) {
                            Logger.log(`Cropping to ${crop.w}x${crop.h}.`);
                            changes.filter_complex[changes.filter_complex.length - 1] += filter_complex_source;
                            changes.filter_complex.push(`${filter_complex_source}crop=${crop.w}:${crop.h}:${crop.x}:${crop.y}`);
                            filter_complex_source = `[${input}-${index}-crop]`;
                        } else {
                            Logger.debug('No cropping necessary.');
                        }
                        // onCancel(cropDetection.cancel.bind(cropDetection));

                    }

                    if (options.scale > 0 && metadata.height > options.scale) {
                        Logger.log(`Video is being downscaled to ${options.scale}p.`);
                        changes.filter_complex[changes.filter_complex.length - 1] += filter_complex_source;
                        changes.filter_complex.push(`${filter_complex_source}scale=-2:${options.scale}`);
                        filter_complex_source = `[${input}-${index}-scale]`;
                    }

                    break;
                }
        }

        changes.filter_complex = changes.filter_complex.join(';');

        return [index, changes];
    }
    async executable(map) {
        let options = this.options;
        let video = this.video;
        let changes = {
            streams: {}
        };

        let promises = [];
        this.progress = {};
        for (let pos in map.streams) {
            promises.push(this.normalizeStream(pos, map));
        }
        const progressUpdate = setInterval(() => {
            if (Object.keys(this.progress).length < 1)
                return;
            Logger.info({
                __tracer_ops: true,
                replace: true,
                id: 'loudnorm'
            }, '[' + chalk.yellow.bold('FFMPEG') + ']', `Normalizing streams: [` + Object.values(this.progress).join('] [') + ']');
        }, 2000);
        onDeath(() => {
            clearInterval(progressUpdate);
        });
        for (const [index, change] of await Promise.all(promises)) {
            clearInterval(progressUpdate);
            merge(changes.streams[index], change);
        }

        let defaultSubtitleSet = false;
        // Attempt to set default subtitle only if a default audio was not set
        if (!this.defaultAudioSet) {
            Logger.debug('No audio stream matching language', chalk.bold(options.language), 'found. No default audio set. Attempting subtitles...');

            for (let pos in map.streams) {
                const index = keys[pos];
                let stream = map.streams[index];
                const input = stream.map.split(':')[0];
                const metadata = video.input.metadata[input].streams[index];

                if (metadata.codec_type !== 'subtitle') continue;

                if (options.language && options.language !== 'Unknown') {
                    if (options.language === getNormalizedStreamLanguage(metadata) && !defaultSubtitleSet) {
                        if (getStreamTitle(metadata) && !~getStreamTitle(metadata).toLowerCase().indexOf('commentary')) {
                            Logger.trace('Skipping eligble subtitle track because it is a commentary tack.');
                        } else {
                            changes.streams[index]['metadata:s:' + pos].push('DISPOSITION:default=1');
                            defaultSubtitleSet = true;
                        }
                    } else {
                        changes.streams[index]['metadata:s:' + pos].push('DISPOSITION:default=0');
                    }
                }
            }
        }

        if (!defaultSubtitleSet)
            Logger.debug('No subtitle stream matching language', chalk.bold(options.language), 'found. No default subtitle set.');

        return changes;
    };

    detectCropAtInterval(start, map) {
        let _self = this;
        return new Promise((resolve, reject, onCancel) => {
            let command = ffmpeg(_self.video.input.path)
                .outputOptions('-map', map)
                .videoFilters("cropdetect=0.094:2:0")
                .format('null')
                .output('-')
                .frames(2)
                .seekInput(start);

            command
                .on('start', function(commandLine) {
                    Logger.trace('[FFMPEG] Query:', commandLine);
                })
                .on('end', function(stdout, stderr) {
                    // _self.emit('statusUpdate', `Completed: ${++_self.completedIntervals}/${_self.options['autocrop-intervals']}`);
                    let matches = /crop=(-?[0-9]+):(-?[0-9]+):(-?[0-9]+):(-?[0-9]+)/g.exec(stderr);
                    if (matches === null) {
                        return reject(new Error('Could not run crop detection.'));
                    }

                    resolve({
                        w: parseInt(matches[1], 10),
                        h: parseInt(matches[2], 10),
                        x: parseInt(matches[3], 10),
                        y: parseInt(matches[4], 10),
                    });
                })
                .on('error', function(err, stdout, stderr) {
                    reject(err);
                })
                .run();

            // onCancel(command.kill.bind(command));
        });
    }

    static options() {
        return {
            'audio-level': {
                default: false,
                describe: 'Normalizes audio level with EBU R128 loudness normalization.',
                type: 'boolean',
                group: 'Audio:'
            },
            'audio-titles': {
                default: true,
                describe: 'Normalizes audio titles with language and format.',
                type: 'boolean',
                group: 'Audio:'
            },
            'subtitle-titles': {
                default: true,
                describe: 'Normalizes subtitle titles with language and format.',
                type: 'boolean',
                group: 'Subtitle:'
            },
            'force': {
                default: false,
                describe: 'Normalize titles even if one already exists for a specific stream.',
                type: 'boolean',
                group: 'Advanced:'
            },
            'language': {
                default: 'eng',
                describe: 'The native language used to select default audio and subtitles. You may use 3 letter or 2 letter ISO 639-2 Alpha-3/Alpha-2 codes or the full language name. Leave empty to disable this feature. Examples: [eng|en|English|jpn|ja|Japanese]',
                type: 'string',
                group: 'General:'
            },
            'scale': {
                default: 0,
                describe: 'Width videos should be down scaled to. Videos will always maintain original aspect ratio. Videos will not be scaled up. Use 0 to disable this feature. [Examples: 720, 480]',
                type: 'number',
                group: 'Video:'
            },
            'autocrop-intervals': {
                default: 12,
                describe: 'Attempts to crop off black bars on a video. Set to 0 to disable.',
                type: 'number',
                group: 'Video:'
            },
        };
    }
}

function measureCrop(detections) {
    let width = Number.NEGATIVE_INFINITY,
        height = Number.NEGATIVE_INFINITY,
        x = Number.POSITIVE_INFINITY,
        y = Number.POSITIVE_INFINITY;

    detections.forEach(function(val, key) {
        if (val.w > width) {
            width = val.w;
            x = val.x;
        }
        if (val.h > height) {
            height = val.h;
            y = val.y;
        }
    });

    return {
        w: width,
        h: height,
        x,
        y
    };
}

function formatAudioChannels(numChannels) {
    let string = "";
    switch (numChannels) {
        case 1:
            string += "Mono";
            break;
        case 2:
            string += "Stereo";
            break;
        default:
            const isOdd = (numChannels % 2 === 1);
            string += isOdd ? (numChannels - 1) : numChannels;
            if (isOdd) string += '.1';
            break;
    }
    return string;
}

function getStreamTitle(metadata) {
    return metadata.title || metadata.tags ? metadata.tags.title : undefined;
}

function getNormalizedStreamLanguage(metadata) {
    let lang = metadata.language || metadata.tags ? metadata.tags.language : undefined;
    return normalizeLanguage(lang);
}

function normalizeLanguage(lang) {
    if (typeof lang === 'undefined')
        return 'Unknown';

    switch (lang.length) {
        case 2:
            return languages.alpha2Languages[lang] || "Unknown";
        case 3:
            return languages.alpha3Languages[lang] || "Unknown";
        default:
            return lang.capitalize() || "Unknown";
    }
}

function momentizeTimemark(timemark) {

    let hours = parseInt(timemark.substring(0, timemark.indexOf(':')), 10);
    let minutes = parseInt(timemark.substring(timemark.indexOf(':') + 1, timemark.lastIndexOf(':')), 10);
    let seconds = parseFloat(timemark.substr(timemark.lastIndexOf(':') + 1));

    return moment.duration().add(hours, 'h').add(minutes, 'm').add(seconds, 's');
}
