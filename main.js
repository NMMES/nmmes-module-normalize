'use strict';

const nmmes = require('nmmes-backend');
const Logger = nmmes.Logger;
const chalk = require('chalk');
const languages = require('./languages.json');

/*
 * Arguments
 * normalizeAudioTitles - (boolean) Set to false if you do not want audio titles normalized
 * normalizeSubtitleTitles - (boolean) Set to false if you do not want subtitle titles normalized
 * force - (boolean) Set titles even if one already exists
 * setDefaultAudio - (boolean) Set to false if you do not want to set a default audio track
 * setDefaultSubtitle - (boolean) Set to false if you do not want to set a default subtitle track
 * language - (string) Language you would like to target for audio and subtitles
 */

module.exports = class Normalize extends nmmes.Module {
    constructor(args) {
        super(require('./package.json'));

        this.args = Object.assign({
            normalizeAudioTitles: true,
            normalizeSubtitleTitles: true,
            setDefaultAudio: true,
            setDefaultSubtitle: true,
            force: false,
            language: 'eng'
        }, args);

        this.args.language = normalizeLanguage(this.args.language);
    }
    init() {
        let _self = this;
        return new Promise(function(resolve, reject) {
            if (_self.args.language === 'Unknown') {
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
    executable(video, map) {
        let _self = this;
        let args = this.args;
        let changes = {
            streams: {}
        };

        let defaultAudioSet = false;
        let defaultSubtitleSet = false;

        return new Promise(function(resolve, reject) {
            const keys = Object.keys(map.streams);
            for (let pos in map.streams) {
                const index = keys[pos];
                let stream = map.streams[index];
                const input = stream.map.split(':')[0];
                const metadata = video.input.metadata[input].streams[index];

                changes.streams[index] = {
                    ['metadata:s:' + pos]: []
                };

                // Skip all streams that are not audio or subtitles
                if (metadata.codec_type !== 'audio' || metadata.codec_type !== 'subtitle') continue;

                // Set normalized titles
                if (((metadata.codec_type === 'audio' && args.normalizeAudioTitles) || (metadata.codec_type === 'subtitle' && args.normalizeSubtitleTitles)) && (!getStreamTitle(metadata) || args.force)) {
                    const title = _self.normalizeStreamTitle(stream);
                    changes.streams[index]['metadata:s:' + pos].push(`title=${title}`);
                    Logger.debug(`Set title for ${metadata.codec_type} stream ${chalk.bold(getStreamTitle(metadata))} [${chalk.bold(stream.map)}] to ${chalk.bold(title)}`);
                }

                // Attempt to set a default audio track
                if ((args.language && args.language !== 'Unknown') && (metadata.codec_type === 'audio' && args.setDefaultAudio)) {
                    if (args.language === getNormalizedStreamLanguage(stream) && !defaultAudioSet) {
                        changes.stream[index]['metadata:s:' + pos].push('DISPOSITION:default=1');
                        defaultAudioSet = true;
                    } else {
                        changes.stream[index]['metadata:s:' + pos].push('DISPOSITION:default=0');
                    }
                }

            }

            // Attempt to set default subtitle only if a default audio was not set
            if (!defaultAudioSet) {
                Logger.debug('No audio stream matching language', chalk.bold(args.language), 'found. No default audio set. Attempting subtitles...');

                for (let pos in map.streams) {
                    const index = keys[pos];
                    let stream = map.streams[index];
                    const input = stream.map.split(':')[0];
                    const metadata = video.input.metadata[input].streams[index];

                    if (metadata.codec_type !== 'subtitle') continue;

                    if ((args.language && args.language !== 'Unknown') && args.setDefaultSubtitle) {
                        if (args.language === getNormalizedStreamLanguage(stream) && !defaultSubtitleSet) {
                            if (getStreamTitle(stream) && !~getStreamTitle(stream).toLowerCase().indexOf('commentary')) {
                                Logger.trace('Skipping eligble subtitle track because it is a commentary tack.');
                            } else {
                                changes.stream[index]['metadata:s:' + pos].push('DISPOSITION:default=1');
                                defaultSubtitleSet = true;
                            }
                        } else {
                            changes.stream[index]['metadata:s:' + pos].push('DISPOSITION:default=0');
                        }
                    }
                }
            }

            if (!defaultSubtitleSet)
                Logger.debug('No subtitle stream matching language', chalk.bold(args.language), 'found. No default subtitle set.');

            resolve(changes);
        });
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

function getStreamTitle(stream) {
    return stream.title || stream.tags ? stream.tags.title : undefined;
}

function getNormalizedStreamLanguage(stream) {
    let lang = stream.language || stream.tags ? stream.tags.language : undefined;
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
