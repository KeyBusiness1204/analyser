/**
 * Pass-through/sink node analysing data.
 *
 * @module  audio-analyser
 */


var inherits = require('inherits');
var Transform = require('stream').Transform;
var extend = require('xtend/mutable');
var pcm = require('pcm-util');
var fft = require('ndarray-fft');
var ndarray = require('ndarray');


/**
 * @constructor
 */
function Analyser (options) {
	if (!(this instanceof Analyser)) return new Analyser(options);

	var self = this;

	Transform.call(self, options);

	//overwrite options
	extend(self, options);

	//time data buffer
	self._data = [];

	//frequency data
	self._fdata = new Float32Array(self.fftSize);

	//data counters
	self._timeoutCount = 0;
	self._fftCount = 0;
}


/** Inherit transform */
inherits(Analyser, Transform);


/** Get PCM format */
extend(Analyser.prototype, pcm.defaultFormat);


/** Magnitude diapasone, in dB **/
Analyser.prototype.minDecibels = -90;
Analyser.prototype.maxDecibels = -30;


/** Number of points to grab **/
Analyser.prototype.fftSize = 1024;

/** Smoothing */
Analyser.prototype.smoothingTimeConstant = 0.2;

/** Number of points to plot */
Analyser.prototype.frequencyBinCount = 1024/2;

/** Throttle each N ms */
Analyser.prototype.throttle = 50;

/** Size of data to buffer, 1s by default */
Analyser.prototype.bufferSize = 44100;

/** Channel to capture */
Analyser.prototype.channel = 0;


/**
 * Basically pass through
 * but provide small delays to avoid blocking timeouts for rendering
 */
Analyser.prototype._transform = function (chunk, enc, cb) {
	var self = this;
	self.push(chunk);
	self._capture(chunk, cb);
};


/**
 * If pipes count is 0 - don’t stack data
 */
Analyser.prototype._write = function (chunk, enc, cb) {
	var self = this;
	if (!self._readableState.pipesCount) {
		self._capture(chunk, cb);
		//just emulate data event
		self.emit('data', chunk);
	} else {
		Transform.prototype._write.call(this, chunk, enc, cb);
	}
};


/**
 * Capture chunk of data for rendering
 */
Analyser.prototype._capture = function (chunk, cb) {
	var self = this;

	//get channel data converting the input
	var channelData = pcm.getChannelData(chunk, self.channel, self).map(function (sample) {
		return pcm.convertSample(sample, self, {float: true});
	});

	//shift data & ensure size
	self._data = self._data.concat(channelData).slice(-self.bufferSize);

	//increase count
	self._timeoutCount += channelData.length;
	self._fftCount += channelData.length;

	//perform fft, if enough new data
	if (self._fftCount >= self.fftSize) {
		self._fftCount = 0;

		var input = self._data.slice(-self.fftSize);
		var inputRe = ndarray(input);
		var inputIm = ndarray(new Float32Array(self.fftSize));

		fft(1, inputRe, inputIm);

		//apply smoothing factor
		var k = self.smoothingTimeConstant;
		for (var i = 0; i < self.fftSize; i++) {
			self._fdata[i] = k* self._fdata[i] + (1 - k) * inputRe.get(i) / self.fftSize;
		}
	}

	//meditate for a processor tick each 50ms to let something other happen
	if (self.throttle && self._timeoutCount / self.sampleRate > self.throttle / 1000) {
		self._timeoutCount %= Math.floor(self.sampleRate / self.throttle);
		setTimeout(cb);
	} else {
		cb();
	}

};


/**
 * AudioAnalyser methods
 */
Analyser.prototype.getFloatFrequencyData = function (arr) {
	var self = this;

	if (!arr) return arr;

	for (var i = 0, l = Math.min(self.frequencyBinCount, arr.length); i < l; i++) {
		arr[i] = self._fdata[i];
	}

	return arr;
};


Analyser.prototype.getByteFrequencyData = function (arr) {
	var self = this;

	if (!arr) return arr;

	for (var i = 0, l = Math.min(self.frequencyBinCount, arr.length); i < l; i++) {
		arr[i] = pcm.convertSample(self._fdata[i], {float: true}, {signed: false, bitDepth: 8});
	}

	return arr;
};


Analyser.prototype.getFloatTimeDomainData = function (arr) {
	var self = this;

	if (!arr) return arr;
	var size = Math.min(arr.length, self.fftSize);

	for (var c = 0, i = self._data.length - self.fftSize, l = i + size; i < l; i++, c++) {
		arr[c] = self._data[i];
	}

	return arr;
};


Analyser.prototype.getByteTimeDomainData = function (arr) {
	var self = this;

	if (!arr) return arr;
	var size = Math.min(arr.length, self.fftSize);

	for (var c = 0, i = self._data.length - self.fftSize, l = i + size; i < l; i++, c++) {
		arr[c] = pcm.convertSample(self._data[i], {float: true}, {signed: false, bitDepth: 8});
	}

	return arr;
};


Analyser.prototype.getFrequencyData = function (size) {
	var result = [];

	size = size || this.fftSize;

	size = Math.min(size, this._fdata.length);

	for (var i = 0; i < size; i++) {
		result.push(this._fdata[i]);
	}

	return result;
};


Analyser.prototype.getTimeData = function (size) {
	var result = [];

	size = size || this.fftSize;

	size = Math.min(size, this._data.length);

	return this._data.slice(-size);
};


module.exports = Analyser;