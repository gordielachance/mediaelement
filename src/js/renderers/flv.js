'use strict';

import window from 'global/window';
import mejs from '../core/mejs';
import {renderer} from '../core/renderer';
import {createEvent} from '../utils/general';
import {HAS_MSE} from '../utils/constants';
import {typeChecks} from '../utils/media';
import {loadScript} from '../utils/dom';

/**
 * Native FLV renderer
 *
 * Uses flv.js, which is a JavaScript library which implements mechanisms to play flv files inspired by flv.js.
 * It relies on HTML5 video and MediaSource Extensions for playback.
 * Currently, it can only play files with the same origin.
 *
 * @see https://github.com/Bilibili/flv.js
 *
 */
const NativeFlv = {

	promise: null,

	/**
	 * Create a queue to prepare the loading of an FLV source
	 * @param {Object} settings - an object with settings needed to load an FLV player instance
	 */
	load: (settings) => {
		if (typeof flvjs !== 'undefined') {
			NativeFlv.promise = new Promise(() => {
				NativeFlv._createPlayer(settings);
			});
		} else if (!NativeFlv.promise) {
			settings.options.path = typeof settings.options.path === 'string' ?
				settings.options.path : 'https://cdnjs.cloudflare.com/ajax/libs/flv.js/1.2.0/flv.min.js';

			NativeFlv.promise = NativeFlv.promise || loadScript(settings.options.path);
			NativeFlv.promise.then(() => {
				NativeFlv._createPlayer(settings);
			});
		}

		return NativeFlv.promise;
	},

	/**
	 * Create a new instance of FLV player and trigger a custom event to initialize it
	 *
	 * @param {Object} settings - an object with settings needed to instantiate FLV object
	 */
	_createPlayer: (settings) => {
		flvjs.LoggingControl.enableDebug = settings.options.debug;
		flvjs.LoggingControl.enableVerbose = settings.options.debug;
		const player = flvjs.createPlayer(settings.options);
		window[`__ready__${settings.id}`](player);
		return player;
	}
};

const FlvNativeRenderer = {
	name: 'native_flv',
	options: {
		prefix: 'native_flv',
		flv: {
			// Special config: used to set the local path/URL of flv.js library
			path: 'https://cdnjs.cloudflare.com/ajax/libs/flv.js/1.2.0/flv.min.js',
			// To modify more elements from FLV player,
			// see https://github.com/Bilibili/flv.js/blob/master/docs/api.md#config
			cors: true,
			debug: false
		}
	},
	/**
	 * Determine if a specific element type can be played with this render
	 *
	 * @param {String} type
	 * @return {Boolean}
	 */
	canPlayType: (type) => HAS_MSE && ['video/x-flv', 'video/flv'].indexOf(type.toLowerCase()) > -1,

	/**
	 * Create the player instance and add all native events/methods/properties as possible
	 *
	 * @param {MediaElement} mediaElement Instance of mejs.MediaElement already created
	 * @param {Object} options All the player configuration options passed through constructor
	 * @param {Object[]} mediaFiles List of sources with format: {src: url, type: x/y-z}
	 * @return {Object}
	 */
	create: (mediaElement, options, mediaFiles) => {

		const
			originalNode = mediaElement.originalNode,
			id = `${mediaElement.id}_${options.prefix}`
		;

		let
			node = null,
			flvPlayer = null
		;

		node = originalNode.cloneNode(true);
		options = Object.assign(options, mediaElement.options);

		const
			props = mejs.html5media.properties,
			assignGettersSetters = (propName) => {
				const capName = `${propName.substring(0, 1).toUpperCase()}${propName.substring(1)}`;

				node[`get${capName}`] = () => flvPlayer !== null ? node[propName] : null;

				node[`set${capName}`] = (value) => {
					if (mejs.html5media.readOnlyProperties.indexOf(propName) === -1) {
						node[propName] = value;

						if (flvPlayer !== null) {
							if (propName === 'src') {
								const flvOptions = {};
								flvOptions.type = 'flv';
								flvOptions.url = value;
								flvOptions.cors = options.flv.cors;
								flvOptions.debug = options.flv.debug;
								flvOptions.path = options.flv.path;

								flvPlayer.destroy();
								flvPlayer = NativeFlv._createPlayer({
									options: flvOptions,
									id: id
								});
								flvPlayer.attachMediaElement(node);
								flvPlayer.load();
							}
						}
					}
				};
			}
		;

		for (let i = 0, total = props.length; i < total; i++) {
			assignGettersSetters(props[i]);
		}

		window['__ready__' + id] = (_flvPlayer) => {
			mediaElement.flvPlayer = flvPlayer = _flvPlayer;

			const
				events = mejs.html5media.events.concat(['click', 'mouseover', 'mouseout']),
				assignEvents = (eventName) => {
					if (eventName === 'loadedmetadata') {
						flvPlayer.unload();
						flvPlayer.detachMediaElement();
						flvPlayer.attachMediaElement(node);
						flvPlayer.load();
					}

					node.addEventListener(eventName, (e) => {
						const event = createEvent(e.type, mediaElement);
						mediaElement.dispatchEvent(event);
					});
				}
			;

			for (let i = 0, total = events.length; i < total; i++) {
				assignEvents(events[i]);
			}
		};

		if (mediaFiles && mediaFiles.length > 0) {
			for (let i = 0, total = mediaFiles.length; i < total; i++) {
				if (renderer.renderers[options.prefix].canPlayType(mediaFiles[i].type)) {
					node.setAttribute('src', mediaFiles[i].src);
					break;
				}
			}
		}

		node.setAttribute('id', id);

		originalNode.parentNode.insertBefore(node, originalNode);
		originalNode.autoplay = false;
		originalNode.style.display = 'none';

		// This approach prevents carrying over unnecessary elements from flv.js
		// in case there are multiple instances of the player
		const flvOptions = {};
		flvOptions.type = 'flv';
		flvOptions.url = node.src;
		flvOptions.cors = options.flv.cors;
		flvOptions.debug = options.flv.debug;
		flvOptions.path = options.flv.path;

		node.setSize = (width, height) => {
			node.style.width = `${width}px`;
			node.style.height = `${height}px`;
			return node;
		};

		node.hide = () => {
			if (flvPlayer !== null) {
				flvPlayer.pause();
			}
			node.style.display = 'none';
			return node;
		};

		node.show = () => {
			node.style.display = '';
			return node;
		};

		node.destroy = () => {
			if (flvPlayer !== null) {
				flvPlayer.destroy();
			}
		};

		const event = createEvent('rendererready', node);
		mediaElement.dispatchEvent(event);

		mediaElement.promises.push(NativeFlv.load({
			options: flvOptions,
			id: id
		}));

		return node;
	}
};

/**
 * Register Native FLV type based on URL structure
 *
 */
typeChecks.push((url) => ~(url.toLowerCase()).indexOf('.flv') ? 'video/flv' : null);

renderer.add(FlvNativeRenderer);
