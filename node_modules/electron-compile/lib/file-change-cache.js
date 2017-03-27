'use strict';

Object.defineProperty(exports, "__esModule", {
  value: true
});

var _fs = require('fs');

var _fs2 = _interopRequireDefault(_fs);

var _zlib = require('zlib');

var _zlib2 = _interopRequireDefault(_zlib);

var _crypto = require('crypto');

var _crypto2 = _interopRequireDefault(_crypto);

var _promise = require('./promise');

var _sanitizePaths = require('./sanitize-paths');

var _sanitizePaths2 = _interopRequireDefault(_sanitizePaths);

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

function _asyncToGenerator(fn) { return function () { var gen = fn.apply(this, arguments); return new Promise(function (resolve, reject) { function step(key, arg) { try { var info = gen[key](arg); var value = info.value; } catch (error) { reject(error); return; } if (info.done) { resolve(value); } else { return Promise.resolve(value).then(function (value) { step("next", value); }, function (err) { step("throw", err); }); } } return step("next"); }); }; }

const d = require('debug')('electron-compile:file-change-cache');

/**
 * This class caches information about files and determines whether they have
 * changed contents or not. Most importantly, this class caches the hash of seen
 * files so that at development time, we don't have to recalculate them constantly.
 *
 * This class is also the core of how electron-compile runs quickly in production
 * mode - after precompilation, the cache is serialized along with the rest of the
 * data in {@link CompilerHost}, so that when we load the app in production mode,
 * we don't end up calculating hashes of file content at all, only using the contents
 * of this cache.
 */
class FileChangedCache {
  constructor(appRoot) {
    let failOnCacheMiss = arguments.length > 1 && arguments[1] !== undefined ? arguments[1] : false;

    this.appRoot = (0, _sanitizePaths2.default)(appRoot);

    this.failOnCacheMiss = failOnCacheMiss;
    this.changeCache = {};
  }

  static removePrefix(needle, haystack) {
    let idx = haystack.toLowerCase().indexOf(needle.toLowerCase());
    if (idx < 0) return haystack;

    return haystack.substring(idx + needle.length);
  }

  /**
   * Allows you to create a FileChangedCache from serialized data saved from
   * {@link getSavedData}.
   *
   * @param  {Object} data  Saved data from getSavedData.
   *
   * @param  {string} appRoot  The top-level directory for your application (i.e.
   *                           the one which has your package.json).
   *
   * @param  {boolean} failOnCacheMiss (optional)  If True, cache misses will throw.
   *
   * @return {FileChangedCache}
   */
  static loadFromData(data, appRoot) {
    let failOnCacheMiss = arguments.length > 2 && arguments[2] !== undefined ? arguments[2] : true;

    let ret = new FileChangedCache(appRoot, failOnCacheMiss);
    ret.changeCache = data.changeCache;
    ret.originalAppRoot = data.appRoot;

    return ret;
  }

  /**
   * Allows you to create a FileChangedCache from serialized data saved from
   * {@link save}.
   *
   * @param  {string} file  Saved data from save.
   *
   * @param  {string} appRoot  The top-level directory for your application (i.e.
   *                           the one which has your package.json).
   *
   * @param  {boolean} failOnCacheMiss (optional)  If True, cache misses will throw.
   *
   * @return {Promise<FileChangedCache>}
   */
  static loadFromFile(file, appRoot) {
    let failOnCacheMiss = arguments.length > 2 && arguments[2] !== undefined ? arguments[2] : true;
    return _asyncToGenerator(function* () {
      d(`Loading canned FileChangedCache from ${file}`);

      let buf = yield _promise.pfs.readFile(file);
      return FileChangedCache.loadFromData(JSON.parse((yield _promise.pzlib.gunzip(buf))), appRoot, failOnCacheMiss);
    })();
  }

  /**
   * Returns information about a given file, including its hash. This method is
   * the main method for this cache.
   *
   * @param  {string} absoluteFilePath  The path to a file to retrieve info on.
   *
   * @return {Promise<Object>}
   *
   * @property {string} hash  The SHA1 hash of the file
   * @property {boolean} isMinified  True if the file is minified
   * @property {boolean} isInNodeModules  True if the file is in a library directory
   * @property {boolean} hasSourceMap  True if the file has a source map
   * @property {boolean} isFileBinary  True if the file is not a text file
   * @property {Buffer} binaryData (optional)  The buffer that was read if the file
   *                                           was binary and there was a cache miss.
   * @property {string} code (optional)  The string that was read if the file
   *                                     was text and there was a cache miss
   */
  getHashForPath(absoluteFilePath) {
    var _this = this;

    return _asyncToGenerator(function* () {
      var _getCacheEntryForPath = _this.getCacheEntryForPath(absoluteFilePath);

      let cacheEntry = _getCacheEntryForPath.cacheEntry,
          cacheKey = _getCacheEntryForPath.cacheKey;


      if (_this.failOnCacheMiss) {
        return cacheEntry.info;
      }

      var _ref = yield _this.getInfoForCacheEntry(absoluteFilePath);

      let ctime = _ref.ctime,
          size = _ref.size;


      if (cacheEntry) {
        let fileHasChanged = yield _this.hasFileChanged(absoluteFilePath, cacheEntry, { ctime, size });

        if (!fileHasChanged) {
          return cacheEntry.info;
        }

        d(`Invalidating cache entry: ${cacheEntry.ctime} === ${ctime} && ${cacheEntry.size} === ${size}`);
        delete _this.changeCache.cacheEntry;
      }

      var _ref2 = yield _this.calculateHashForFile(absoluteFilePath);

      let digest = _ref2.digest,
          sourceCode = _ref2.sourceCode,
          binaryData = _ref2.binaryData;


      let info = {
        hash: digest,
        isMinified: FileChangedCache.contentsAreMinified(sourceCode || ''),
        isInNodeModules: FileChangedCache.isInNodeModules(absoluteFilePath),
        hasSourceMap: FileChangedCache.hasSourceMap(sourceCode || ''),
        isFileBinary: !!binaryData
      };

      _this.changeCache[cacheKey] = { ctime, size, info };
      d(`Cache entry for ${cacheKey}: ${JSON.stringify(_this.changeCache[cacheKey])}`);

      if (binaryData) {
        return Object.assign({ binaryData }, info);
      } else {
        return Object.assign({ sourceCode }, info);
      }
    })();
  }

  getInfoForCacheEntry(absoluteFilePath) {
    return _asyncToGenerator(function* () {
      let stat = yield _promise.pfs.stat(absoluteFilePath);
      if (!stat || !stat.isFile()) throw new Error(`Can't stat ${absoluteFilePath}`);

      return {
        stat,
        ctime: stat.ctime.getTime(),
        size: stat.size
      };
    })();
  }

  /**
   * Gets the cached data for a file path, if it exists.
   *
   * @param  {string} absoluteFilePath  The path to a file to retrieve info on.
   *
   * @return {Object}
   */
  getCacheEntryForPath(absoluteFilePath) {
    let cacheKey = (0, _sanitizePaths2.default)(absoluteFilePath);
    if (this.appRoot) {
      cacheKey = cacheKey.replace(this.appRoot, '');
    }

    // NB: We do this because x-require will include an absolute path from the
    // original built app and we need to still grok it
    if (this.originalAppRoot) {
      cacheKey = cacheKey.replace(this.originalAppRoot, '');
    }

    let cacheEntry = this.changeCache[cacheKey];

    if (this.failOnCacheMiss) {
      if (!cacheEntry) {
        d(`Tried to read file cache entry for ${absoluteFilePath}`);
        d(`cacheKey: ${cacheKey}, appRoot: ${this.appRoot}, originalAppRoot: ${this.originalAppRoot}`);
        throw new Error(`Asked for ${absoluteFilePath} but it was not precompiled!`);
      }
    }

    return { cacheEntry, cacheKey };
  }

  /**
   * Checks the file cache to see if a file has changed.
   *
   * @param  {string} absoluteFilePath  The path to a file to retrieve info on.
   * @param  {Object} cacheEntry  Cache data from {@link getCacheEntryForPath}
   *
   * @return {boolean}
   */
  hasFileChanged(absoluteFilePath) {
    var _this2 = this;

    let cacheEntry = arguments.length > 1 && arguments[1] !== undefined ? arguments[1] : null;
    let fileHashInfo = arguments.length > 2 && arguments[2] !== undefined ? arguments[2] : null;
    return _asyncToGenerator(function* () {
      cacheEntry = cacheEntry || _this2.getCacheEntryForPath(absoluteFilePath).cacheEntry;
      fileHashInfo = fileHashInfo || (yield _this2.getInfoForCacheEntry(absoluteFilePath));

      if (cacheEntry) {
        return !(cacheEntry.ctime >= fileHashInfo.ctime && cacheEntry.size === fileHashInfo.size);
      }

      return false;
    })();
  }

  /**
   * Returns data that can passed to {@link loadFromData} to rehydrate this cache.
   *
   * @return {Object}
   */
  getSavedData() {
    return { changeCache: this.changeCache, appRoot: this.appRoot };
  }

  /**
   * Serializes this object's data to a file.
   *
   * @param {string} filePath  The path to save data to.
   *
   * @return {Promise} Completion.
   */
  save(filePath) {
    var _this3 = this;

    return _asyncToGenerator(function* () {
      let toSave = _this3.getSavedData();

      let buf = yield _promise.pzlib.gzip(new Buffer(JSON.stringify(toSave)));
      yield _promise.pfs.writeFile(filePath, buf);
    })();
  }

  calculateHashForFile(absoluteFilePath) {
    return _asyncToGenerator(function* () {
      let buf = yield _promise.pfs.readFile(absoluteFilePath);
      let encoding = FileChangedCache.detectFileEncoding(buf);

      if (!encoding) {
        let digest = _crypto2.default.createHash('sha1').update(buf).digest('hex');
        return { sourceCode: null, digest, binaryData: buf };
      }

      let sourceCode = yield _promise.pfs.readFile(absoluteFilePath, encoding);
      let digest = _crypto2.default.createHash('sha1').update(sourceCode, 'utf8').digest('hex');

      return { sourceCode, digest, binaryData: null };
    })();
  }

  getHashForPathSync(absoluteFilePath) {
    let cacheKey = (0, _sanitizePaths2.default)(absoluteFilePath);

    if (this.appRoot) {
      cacheKey = FileChangedCache.removePrefix(this.appRoot, cacheKey);
    }

    // NB: We do this because x-require will include an absolute path from the
    // original built app and we need to still grok it
    if (this.originalAppRoot) {
      cacheKey = FileChangedCache.removePrefix(this.originalAppRoot, cacheKey);
    }

    let cacheEntry = this.changeCache[cacheKey];

    if (this.failOnCacheMiss) {
      if (!cacheEntry) {
        d(`Tried to read file cache entry for ${absoluteFilePath}`);
        d(`cacheKey: ${cacheKey}, appRoot: ${this.appRoot}, originalAppRoot: ${this.originalAppRoot}`);
        throw new Error(`Asked for ${absoluteFilePath} but it was not precompiled!`);
      }

      return cacheEntry.info;
    }

    let stat = _fs2.default.statSync(absoluteFilePath);
    let ctime = stat.ctime.getTime();
    let size = stat.size;
    if (!stat || !stat.isFile()) throw new Error(`Can't stat ${absoluteFilePath}`);

    if (cacheEntry) {
      if (cacheEntry.ctime >= ctime && cacheEntry.size === size) {
        return cacheEntry.info;
      }

      d(`Invalidating cache entry: ${cacheEntry.ctime} === ${ctime} && ${cacheEntry.size} === ${size}`);
      delete this.changeCache.cacheEntry;
    }

    var _calculateHashForFile = this.calculateHashForFileSync(absoluteFilePath);

    let digest = _calculateHashForFile.digest,
        sourceCode = _calculateHashForFile.sourceCode,
        binaryData = _calculateHashForFile.binaryData;


    let info = {
      hash: digest,
      isMinified: FileChangedCache.contentsAreMinified(sourceCode || ''),
      isInNodeModules: FileChangedCache.isInNodeModules(absoluteFilePath),
      hasSourceMap: FileChangedCache.hasSourceMap(sourceCode || ''),
      isFileBinary: !!binaryData
    };

    this.changeCache[cacheKey] = { ctime, size, info };
    d(`Cache entry for ${cacheKey}: ${JSON.stringify(this.changeCache[cacheKey])}`);

    if (binaryData) {
      return Object.assign({ binaryData }, info);
    } else {
      return Object.assign({ sourceCode }, info);
    }
  }

  saveSync(filePath) {
    let toSave = this.getSavedData();

    let buf = _zlib2.default.gzipSync(new Buffer(JSON.stringify(toSave)));
    _fs2.default.writeFileSync(filePath, buf);
  }

  calculateHashForFileSync(absoluteFilePath) {
    let buf = _fs2.default.readFileSync(absoluteFilePath);
    let encoding = FileChangedCache.detectFileEncoding(buf);

    if (!encoding) {
      let digest = _crypto2.default.createHash('sha1').update(buf).digest('hex');
      return { sourceCode: null, digest, binaryData: buf };
    }

    let sourceCode = _fs2.default.readFileSync(absoluteFilePath, encoding);
    let digest = _crypto2.default.createHash('sha1').update(sourceCode, 'utf8').digest('hex');

    return { sourceCode, digest, binaryData: null };
  }

  /**
   * Determines via some statistics whether a file is likely to be minified.
   *
   * @private
   */
  static contentsAreMinified(source) {
    let length = source.length;
    if (length > 1024) length = 1024;

    let newlineCount = 0;

    // Roll through the characters and determine the average line length
    for (let i = 0; i < source.length; i++) {
      if (source[i] === '\n') newlineCount++;
    }

    // No Newlines? Any file other than a super small one is minified
    if (newlineCount === 0) {
      return length > 80;
    }

    let avgLineLength = length / newlineCount;
    return avgLineLength > 80;
  }

  /**
   * Determines whether a path is in node_modules or the Electron init code
   *
   * @private
   */
  static isInNodeModules(filePath) {
    return !!(filePath.match(/(node_modules|bower_components)[\\\/]/i) || filePath.match(/(atom|electron)\.asar/));
  }

  /**
   * Returns whether a file has an inline source map
   *
   * @private
   */
  static hasSourceMap(sourceCode) {
    const trimmed = sourceCode.trim();
    return trimmed.lastIndexOf('//# sourceMap') > trimmed.lastIndexOf('\n');
  }

  /**
   * Determines the encoding of a file from the two most common encodings by trying
   * to decode it then looking for encoding errors
   *
   * @private
   */
  static detectFileEncoding(buffer) {
    if (buffer.length < 1) return false;
    let buf = buffer.length < 4096 ? buffer : buffer.slice(0, 4096);

    const encodings = ['utf8', 'utf16le'];

    let encoding;
    if (buffer.length <= 128) {
      encoding = encodings.find(x => Buffer.compare(new Buffer(buffer.toString(), x), buffer) === 0);
    } else {
      encoding = encodings.find(x => !FileChangedCache.containsControlCharacters(buf.toString(x)));
    }

    return encoding;
  }

  /**
   * Determines whether a string is likely to be poorly encoded by looking for
   * control characters above a certain threshold
   *
   * @private
   */
  static containsControlCharacters(str) {
    let controlCount = 0;
    let spaceCount = 0;
    let threshold = 2;
    if (str.length > 64) threshold = 4;
    if (str.length > 512) threshold = 8;

    for (let i = 0; i < str.length; i++) {
      let c = str.charCodeAt(i);
      if (c === 65536 || c < 8) controlCount++;
      if (c > 14 && c < 32) controlCount++;
      if (c === 32) spaceCount++;

      if (controlCount > threshold) return true;
    }

    if (spaceCount < threshold) return true;

    if (controlCount === 0) return false;
    return controlCount / str.length < 0.02;
  }
}
exports.default = FileChangedCache;
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJzb3VyY2VzIjpbIi4uL3NyYy9maWxlLWNoYW5nZS1jYWNoZS5qcyJdLCJuYW1lcyI6WyJkIiwicmVxdWlyZSIsIkZpbGVDaGFuZ2VkQ2FjaGUiLCJjb25zdHJ1Y3RvciIsImFwcFJvb3QiLCJmYWlsT25DYWNoZU1pc3MiLCJjaGFuZ2VDYWNoZSIsInJlbW92ZVByZWZpeCIsIm5lZWRsZSIsImhheXN0YWNrIiwiaWR4IiwidG9Mb3dlckNhc2UiLCJpbmRleE9mIiwic3Vic3RyaW5nIiwibGVuZ3RoIiwibG9hZEZyb21EYXRhIiwiZGF0YSIsInJldCIsIm9yaWdpbmFsQXBwUm9vdCIsImxvYWRGcm9tRmlsZSIsImZpbGUiLCJidWYiLCJyZWFkRmlsZSIsIkpTT04iLCJwYXJzZSIsImd1bnppcCIsImdldEhhc2hGb3JQYXRoIiwiYWJzb2x1dGVGaWxlUGF0aCIsImdldENhY2hlRW50cnlGb3JQYXRoIiwiY2FjaGVFbnRyeSIsImNhY2hlS2V5IiwiaW5mbyIsImdldEluZm9Gb3JDYWNoZUVudHJ5IiwiY3RpbWUiLCJzaXplIiwiZmlsZUhhc0NoYW5nZWQiLCJoYXNGaWxlQ2hhbmdlZCIsImNhbGN1bGF0ZUhhc2hGb3JGaWxlIiwiZGlnZXN0Iiwic291cmNlQ29kZSIsImJpbmFyeURhdGEiLCJoYXNoIiwiaXNNaW5pZmllZCIsImNvbnRlbnRzQXJlTWluaWZpZWQiLCJpc0luTm9kZU1vZHVsZXMiLCJoYXNTb3VyY2VNYXAiLCJpc0ZpbGVCaW5hcnkiLCJzdHJpbmdpZnkiLCJPYmplY3QiLCJhc3NpZ24iLCJzdGF0IiwiaXNGaWxlIiwiRXJyb3IiLCJnZXRUaW1lIiwicmVwbGFjZSIsImZpbGVIYXNoSW5mbyIsImdldFNhdmVkRGF0YSIsInNhdmUiLCJmaWxlUGF0aCIsInRvU2F2ZSIsImd6aXAiLCJCdWZmZXIiLCJ3cml0ZUZpbGUiLCJlbmNvZGluZyIsImRldGVjdEZpbGVFbmNvZGluZyIsImNyZWF0ZUhhc2giLCJ1cGRhdGUiLCJnZXRIYXNoRm9yUGF0aFN5bmMiLCJzdGF0U3luYyIsImNhbGN1bGF0ZUhhc2hGb3JGaWxlU3luYyIsInNhdmVTeW5jIiwiZ3ppcFN5bmMiLCJ3cml0ZUZpbGVTeW5jIiwicmVhZEZpbGVTeW5jIiwic291cmNlIiwibmV3bGluZUNvdW50IiwiaSIsImF2Z0xpbmVMZW5ndGgiLCJtYXRjaCIsInRyaW1tZWQiLCJ0cmltIiwibGFzdEluZGV4T2YiLCJidWZmZXIiLCJzbGljZSIsImVuY29kaW5ncyIsImZpbmQiLCJ4IiwiY29tcGFyZSIsInRvU3RyaW5nIiwiY29udGFpbnNDb250cm9sQ2hhcmFjdGVycyIsInN0ciIsImNvbnRyb2xDb3VudCIsInNwYWNlQ291bnQiLCJ0aHJlc2hvbGQiLCJjIiwiY2hhckNvZGVBdCJdLCJtYXBwaW5ncyI6Ijs7Ozs7O0FBQUE7Ozs7QUFDQTs7OztBQUNBOzs7O0FBQ0E7O0FBQ0E7Ozs7Ozs7O0FBRUEsTUFBTUEsSUFBSUMsUUFBUSxPQUFSLEVBQWlCLG9DQUFqQixDQUFWOztBQUVBOzs7Ozs7Ozs7OztBQVdlLE1BQU1DLGdCQUFOLENBQXVCO0FBQ3BDQyxjQUFZQyxPQUFaLEVBQTRDO0FBQUEsUUFBdkJDLGVBQXVCLHVFQUFQLEtBQU87O0FBQzFDLFNBQUtELE9BQUwsR0FBZSw2QkFBaUJBLE9BQWpCLENBQWY7O0FBRUEsU0FBS0MsZUFBTCxHQUF1QkEsZUFBdkI7QUFDQSxTQUFLQyxXQUFMLEdBQW1CLEVBQW5CO0FBQ0Q7O0FBRUQsU0FBT0MsWUFBUCxDQUFvQkMsTUFBcEIsRUFBNEJDLFFBQTVCLEVBQXNDO0FBQ3BDLFFBQUlDLE1BQU1ELFNBQVNFLFdBQVQsR0FBdUJDLE9BQXZCLENBQStCSixPQUFPRyxXQUFQLEVBQS9CLENBQVY7QUFDQSxRQUFJRCxNQUFNLENBQVYsRUFBYSxPQUFPRCxRQUFQOztBQUViLFdBQU9BLFNBQVNJLFNBQVQsQ0FBbUJILE1BQU1GLE9BQU9NLE1BQWhDLENBQVA7QUFDRDs7QUFFRDs7Ozs7Ozs7Ozs7OztBQWFBLFNBQU9DLFlBQVAsQ0FBb0JDLElBQXBCLEVBQTBCWixPQUExQixFQUF5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R0FBakIsRUFBc0IrRSxZQUFZLENBQVo7O0FBRXRCLFNBQUssSUFBSWpCLElBQUUsQ0FBWCxFQUFjQSxJQUFJYyxJQUFJNUUsTUFBdEIsRUFBOEI4RCxHQUE5QixFQUFtQztBQUNqQyxVQUFJa0IsSUFBSUosSUFBSUssVUFBSixDQUFlbkIsQ0FBZixDQUFSO0FBQ0EsVUFBSWtCLE1BQU0sS0FBTixJQUFlQSxJQUFJLENBQXZCLEVBQTBCSDtBQUMxQixVQUFJRyxJQUFJLEVBQUosSUFBVUEsSUFBSSxFQUFsQixFQUFzQkg7QUFDdEIsVUFBSUcsTUFBTSxFQUFWLEVBQWNGOztBQUVkLFVBQUlELGVBQWVFLFNBQW5CLEVBQThCLE9BQU8sSUFBUDtBQUMvQjs7QUFFRCxRQUFJRCxhQUFhQyxTQUFqQixFQUE0QixPQUFPLElBQVA7O0FBRTVCLFFBQUlGLGlCQUFpQixDQUFyQixFQUF3QixPQUFPLEtBQVA7QUFDeEIsV0FBUUEsZUFBZUQsSUFBSTVFLE1BQXBCLEdBQThCLElBQXJDO0FBQ0Q7QUExWW1DO2tCQUFqQlosZ0IiLCJmaWxlIjoiZmlsZS1jaGFuZ2UtY2FjaGUuanMiLCJzb3VyY2VzQ29udGVudCI6WyJpbXBvcnQgZnMgZnJvbSAnZnMnO1xuaW1wb3J0IHpsaWIgZnJvbSAnemxpYic7XG5pbXBvcnQgY3J5cHRvIGZyb20gJ2NyeXB0byc7XG5pbXBvcnQge3BmcywgcHpsaWJ9IGZyb20gJy4vcHJvbWlzZSc7XG5pbXBvcnQgc2FuaXRpemVGaWxlUGF0aCBmcm9tICcuL3Nhbml0aXplLXBhdGhzJztcblxuY29uc3QgZCA9IHJlcXVpcmUoJ2RlYnVnJykoJ2VsZWN0cm9uLWNvbXBpbGU6ZmlsZS1jaGFuZ2UtY2FjaGUnKTtcblxuLyoqXG4gKiBUaGlzIGNsYXNzIGNhY2hlcyBpbmZvcm1hdGlvbiBhYm91dCBmaWxlcyBhbmQgZGV0ZXJtaW5lcyB3aGV0aGVyIHRoZXkgaGF2ZVxuICogY2hhbmdlZCBjb250ZW50cyBvciBub3QuIE1vc3QgaW1wb3J0YW50bHksIHRoaXMgY2xhc3MgY2FjaGVzIHRoZSBoYXNoIG9mIHNlZW5cbiAqIGZpbGVzIHNvIHRoYXQgYXQgZGV2ZWxvcG1lbnQgdGltZSwgd2UgZG9uJ3QgaGF2ZSB0byByZWNhbGN1bGF0ZSB0aGVtIGNvbnN0YW50bHkuXG4gKlxuICogVGhpcyBjbGFzcyBpcyBhbHNvIHRoZSBjb3JlIG9mIGhvdyBlbGVjdHJvbi1jb21waWxlIHJ1bnMgcXVpY2tseSBpbiBwcm9kdWN0aW9uXG4gKiBtb2RlIC0gYWZ0ZXIgcHJlY29tcGlsYXRpb24sIHRoZSBjYWNoZSBpcyBzZXJpYWxpemVkIGFsb25nIHdpdGggdGhlIHJlc3Qgb2YgdGhlXG4gKiBkYXRhIGluIHtAbGluayBDb21waWxlckhvc3R9LCBzbyB0aGF0IHdoZW4gd2UgbG9hZCB0aGUgYXBwIGluIHByb2R1Y3Rpb24gbW9kZSxcbiAqIHdlIGRvbid0IGVuZCB1cCBjYWxjdWxhdGluZyBoYXNoZXMgb2YgZmlsZSBjb250ZW50IGF0IGFsbCwgb25seSB1c2luZyB0aGUgY29udGVudHNcbiAqIG9mIHRoaXMgY2FjaGUuXG4gKi9cbmV4cG9ydCBkZWZhdWx0IGNsYXNzIEZpbGVDaGFuZ2VkQ2FjaGUge1xuICBjb25zdHJ1Y3RvcihhcHBSb290LCBmYWlsT25DYWNoZU1pc3M9ZmFsc2UpIHtcbiAgICB0aGlzLmFwcFJvb3QgPSBzYW5pdGl6ZUZpbGVQYXRoKGFwcFJvb3QpO1xuXG4gICAgdGhpcy5mYWlsT25DYWNoZU1pc3MgPSBmYWlsT25DYWNoZU1pc3M7XG4gICAgdGhpcy5jaGFuZ2VDYWNoZSA9IHt9O1xuICB9XG5cbiAgc3RhdGljIHJlbW92ZVByZWZpeChuZWVkbGUsIGhheXN0YWNrKSB7XG4gICAgbGV0IGlkeCA9IGhheXN0YWNrLnRvTG93ZXJDYXNlKCkuaW5kZXhPZihuZWVkbGUudG9Mb3dlckNhc2UoKSk7XG4gICAgaWYgKGlkeCA8IDApIHJldHVybiBoYXlzdGFjaztcblxuICAgIHJldHVybiBoYXlzdGFjay5zdWJzdHJpbmcoaWR4ICsgbmVlZGxlLmxlbmd0aCk7XG4gIH1cblxuICAvKipcbiAgICogQWxsb3dzIHlvdSB0byBjcmVhdGUgYSBGaWxlQ2hhbmdlZENhY2hlIGZyb20gc2VyaWFsaXplZCBkYXRhIHNhdmVkIGZyb21cbiAgICoge0BsaW5rIGdldFNhdmVkRGF0YX0uXG4gICAqXG4gICAqIEBwYXJhbSAge09iamVjdH0gZGF0YSAgU2F2ZWQgZGF0YSBmcm9tIGdldFNhdmVkRGF0YS5cbiAgICpcbiAgICogQHBhcmFtICB7c3RyaW5nfSBhcHBSb290ICBUaGUgdG9wLWxldmVsIGRpcmVjdG9yeSBmb3IgeW91ciBhcHBsaWNhdGlvbiAoaS5lLlxuICAgKiAgICAgICAgICAgICAgICAgICAgICAgICAgIHRoZSBvbmUgd2hpY2ggaGFzIHlvdXIgcGFja2FnZS5qc29uKS5cbiAgICpcbiAgICogQHBhcmFtICB7Ym9vbGVhbn0gZmFpbE9uQ2FjaGVNaXNzIChvcHRpb25hbCkgIElmIFRydWUsIGNhY2hlIG1pc3NlcyB3aWxsIHRocm93LlxuICAgKlxuICAgKiBAcmV0dXJuIHtGaWxlQ2hhbmdlZENhY2hlfVxuICAgKi9cbiAgc3RhdGljIGxvYWRGcm9tRGF0YShkYXRhLCBhcHBSb290LCBmYWlsT25DYWNoZU1pc3M9dHJ1ZSkge1xuICAgIGxldCByZXQgPSBuZXcgRmlsZUNoYW5nZWRDYWNoZShhcHBSb290LCBmYWlsT25DYWNoZU1pc3MpO1xuICAgIHJldC5jaGFuZ2VDYWNoZSA9IGRhdGEuY2hhbmdlQ2FjaGU7XG4gICAgcmV0Lm9yaWdpbmFsQXBwUm9vdCA9IGRhdGEuYXBwUm9vdDtcblxuICAgIHJldHVybiByZXQ7XG4gIH1cblxuXG4gIC8qKlxuICAgKiBBbGxvd3MgeW91IHRvIGNyZWF0ZSBhIEZpbGVDaGFuZ2VkQ2FjaGUgZnJvbSBzZXJpYWxpemVkIGRhdGEgc2F2ZWQgZnJvbVxuICAgKiB7QGxpbmsgc2F2ZX0uXG4gICAqXG4gICAqIEBwYXJhbSAge3N0cmluZ30gZmlsZSAgU2F2ZWQgZGF0YSBmcm9tIHNhdmUuXG4gICAqXG4gICAqIEBwYXJhbSAge3N0cmluZ30gYXBwUm9vdCAgVGhlIHRvcC1sZXZlbCBkaXJlY3RvcnkgZm9yIHlvdXIgYXBwbGljYXRpb24gKGkuZS5cbiAgICogICAgICAgICAgICAgICAgICAgICAgICAgICB0aGUgb25lIHdoaWNoIGhhcyB5b3VyIHBhY2thZ2UuanNvbikuXG4gICAqXG4gICAqIEBwYXJhbSAge2Jvb2xlYW59IGZhaWxPbkNhY2hlTWlzcyAob3B0aW9uYWwpICBJZiBUcnVlLCBjYWNoZSBtaXNzZXMgd2lsbCB0aHJvdy5cbiAgICpcbiAgICogQHJldHVybiB7UHJvbWlzZTxGaWxlQ2hhbmdlZENhY2hlPn1cbiAgICovXG4gIHN0YXRpYyBhc3luYyBsb2FkRnJvbUZpbGUoZmlsZSwgYXBwUm9vdCwgZmFpbE9uQ2FjaGVNaXNzPXRydWUpIHtcbiAgICBkKGBMb2FkaW5nIGNhbm5lZCBGaWxlQ2hhbmdlZENhY2hlIGZyb20gJHtmaWxlfWApO1xuXG4gICAgbGV0IGJ1ZiA9IGF3YWl0IHBmcy5yZWFkRmlsZShmaWxlKTtcbiAgICByZXR1cm4gRmlsZUNoYW5nZWRDYWNoZS5sb2FkRnJvbURhdGEoSlNPTi5wYXJzZShhd2FpdCBwemxpYi5ndW56aXAoYnVmKSksIGFwcFJvb3QsIGZhaWxPbkNhY2hlTWlzcyk7XG4gIH1cblxuXG4gIC8qKlxuICAgKiBSZXR1cm5zIGluZm9ybWF0aW9uIGFib3V0IGEgZ2l2ZW4gZmlsZSwgaW5jbHVkaW5nIGl0cyBoYXNoLiBUaGlzIG1ldGhvZCBpc1xuICAgKiB0aGUgbWFpbiBtZXRob2QgZm9yIHRoaXMgY2FjaGUuXG4gICAqXG4gICAqIEBwYXJhbSAge3N0cmluZ30gYWJzb2x1dGVGaWxlUGF0aCAgVGhlIHBhdGggdG8gYSBmaWxlIHRvIHJldHJpZXZlIGluZm8gb24uXG4gICAqXG4gICAqIEByZXR1cm4ge1Byb21pc2U8T2JqZWN0Pn1cbiAgICpcbiAgICogQHByb3BlcnR5IHtzdHJpbmd9IGhhc2ggIFRoZSBTSEExIGhhc2ggb2YgdGhlIGZpbGVcbiAgICogQHByb3BlcnR5IHtib29sZWFufSBpc01pbmlmaWVkICBUcnVlIGlmIHRoZSBmaWxlIGlzIG1pbmlmaWVkXG4gICAqIEBwcm9wZXJ0eSB7Ym9vbGVhbn0gaXNJbk5vZGVNb2R1bGVzICBUcnVlIGlmIHRoZSBmaWxlIGlzIGluIGEgbGlicmFyeSBkaXJlY3RvcnlcbiAgICogQHByb3BlcnR5IHtib29sZWFufSBoYXNTb3VyY2VNYXAgIFRydWUgaWYgdGhlIGZpbGUgaGFzIGEgc291cmNlIG1hcFxuICAgKiBAcHJvcGVydHkge2Jvb2xlYW59IGlzRmlsZUJpbmFyeSAgVHJ1ZSBpZiB0aGUgZmlsZSBpcyBub3QgYSB0ZXh0IGZpbGVcbiAgICogQHByb3BlcnR5IHtCdWZmZXJ9IGJpbmFyeURhdGEgKG9wdGlvbmFsKSAgVGhlIGJ1ZmZlciB0aGF0IHdhcyByZWFkIGlmIHRoZSBmaWxlXG4gICAqICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIHdhcyBiaW5hcnkgYW5kIHRoZXJlIHdhcyBhIGNhY2hlIG1pc3MuXG4gICAqIEBwcm9wZXJ0eSB7c3RyaW5nfSBjb2RlIChvcHRpb25hbCkgIFRoZSBzdHJpbmcgdGhhdCB3YXMgcmVhZCBpZiB0aGUgZmlsZVxuICAgKiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICB3YXMgdGV4dCBhbmQgdGhlcmUgd2FzIGEgY2FjaGUgbWlzc1xuICAgKi9cbiAgYXN5bmMgZ2V0SGFzaEZvclBhdGgoYWJzb2x1dGVGaWxlUGF0aCkge1xuICAgIGxldCB7Y2FjaGVFbnRyeSwgY2FjaGVLZXl9ID0gdGhpcy5nZXRDYWNoZUVudHJ5Rm9yUGF0aChhYnNvbHV0ZUZpbGVQYXRoKTtcblxuICAgIGlmICh0aGlzLmZhaWxPbkNhY2hlTWlzcykge1xuICAgICAgcmV0dXJuIGNhY2hlRW50cnkuaW5mbztcbiAgICB9XG5cbiAgICBsZXQge2N0aW1lLCBzaXplfSA9IGF3YWl0IHRoaXMuZ2V0SW5mb0ZvckNhY2hlRW50cnkoYWJzb2x1dGVGaWxlUGF0aCk7XG5cbiAgICBpZiAoY2FjaGVFbnRyeSkge1xuICAgICAgbGV0IGZpbGVIYXNDaGFuZ2VkID0gYXdhaXQgdGhpcy5oYXNGaWxlQ2hhbmdlZChhYnNvbHV0ZUZpbGVQYXRoLCBjYWNoZUVudHJ5LCB7Y3RpbWUsIHNpemV9KTtcblxuICAgICAgaWYgKCFmaWxlSGFzQ2hhbmdlZCkge1xuICAgICAgICByZXR1cm4gY2FjaGVFbnRyeS5pbmZvO1xuICAgICAgfVxuXG4gICAgICBkKGBJbnZhbGlkYXRpbmcgY2FjaGUgZW50cnk6ICR7Y2FjaGVFbnRyeS5jdGltZX0gPT09ICR7Y3RpbWV9ICYmICR7Y2FjaGVFbnRyeS5zaXplfSA9PT0gJHtzaXplfWApO1xuICAgICAgZGVsZXRlIHRoaXMuY2hhbmdlQ2FjaGUuY2FjaGVFbnRyeTtcbiAgICB9XG5cbiAgICBsZXQge2RpZ2VzdCwgc291cmNlQ29kZSwgYmluYXJ5RGF0YX0gPSBhd2FpdCB0aGlzLmNhbGN1bGF0ZUhhc2hGb3JGaWxlKGFic29sdXRlRmlsZVBhdGgpO1xuXG4gICAgbGV0IGluZm8gPSB7XG4gICAgICBoYXNoOiBkaWdlc3QsXG4gICAgICBpc01pbmlmaWVkOiBGaWxlQ2hhbmdlZENhY2hlLmNvbnRlbnRzQXJlTWluaWZpZWQoc291cmNlQ29kZSB8fCAnJyksXG4gICAgICBpc0luTm9kZU1vZHVsZXM6IEZpbGVDaGFuZ2VkQ2FjaGUuaXNJbk5vZGVNb2R1bGVzKGFic29sdXRlRmlsZVBhdGgpLFxuICAgICAgaGFzU291cmNlTWFwOiBGaWxlQ2hhbmdlZENhY2hlLmhhc1NvdXJjZU1hcChzb3VyY2VDb2RlIHx8ICcnKSxcbiAgICAgIGlzRmlsZUJpbmFyeTogISFiaW5hcnlEYXRhXG4gICAgfTtcblxuICAgIHRoaXMuY2hhbmdlQ2FjaGVbY2FjaGVLZXldID0geyBjdGltZSwgc2l6ZSwgaW5mbyB9O1xuICAgIGQoYENhY2hlIGVudHJ5IGZvciAke2NhY2hlS2V5fTogJHtKU09OLnN0cmluZ2lmeSh0aGlzLmNoYW5nZUNhY2hlW2NhY2hlS2V5XSl9YCk7XG5cbiAgICBpZiAoYmluYXJ5RGF0YSkge1xuICAgICAgcmV0dXJuIE9iamVjdC5hc3NpZ24oe2JpbmFyeURhdGF9LCBpbmZvKTtcbiAgICB9IGVsc2Uge1xuICAgICAgcmV0dXJuIE9iamVjdC5hc3NpZ24oe3NvdXJjZUNvZGV9LCBpbmZvKTtcbiAgICB9XG4gIH1cblxuICBhc3luYyBnZXRJbmZvRm9yQ2FjaGVFbnRyeShhYnNvbHV0ZUZpbGVQYXRoKSB7XG4gICAgbGV0IHN0YXQgPSBhd2FpdCBwZnMuc3RhdChhYnNvbHV0ZUZpbGVQYXRoKTtcbiAgICBpZiAoIXN0YXQgfHwgIXN0YXQuaXNGaWxlKCkpIHRocm93IG5ldyBFcnJvcihgQ2FuJ3Qgc3RhdCAke2Fic29sdXRlRmlsZVBhdGh9YCk7XG5cbiAgICByZXR1cm4ge1xuICAgICAgc3RhdCxcbiAgICAgIGN0aW1lOiBzdGF0LmN0aW1lLmdldFRpbWUoKSxcbiAgICAgIHNpemU6IHN0YXQuc2l6ZVxuICAgIH07XG4gIH1cblxuICAvKipcbiAgICogR2V0cyB0aGUgY2FjaGVkIGRhdGEgZm9yIGEgZmlsZSBwYXRoLCBpZiBpdCBleGlzdHMuXG4gICAqXG4gICAqIEBwYXJhbSAge3N0cmluZ30gYWJzb2x1dGVGaWxlUGF0aCAgVGhlIHBhdGggdG8gYSBmaWxlIHRvIHJldHJpZXZlIGluZm8gb24uXG4gICAqXG4gICAqIEByZXR1cm4ge09iamVjdH1cbiAgICovXG4gIGdldENhY2hlRW50cnlGb3JQYXRoKGFic29sdXRlRmlsZVBhdGgpIHtcbiAgICBsZXQgY2FjaGVLZXkgPSBzYW5pdGl6ZUZpbGVQYXRoKGFic29sdXRlRmlsZVBhdGgpO1xuICAgIGlmICh0aGlzLmFwcFJvb3QpIHtcbiAgICAgIGNhY2hlS2V5ID0gY2FjaGVLZXkucmVwbGFjZSh0aGlzLmFwcFJvb3QsICcnKTtcbiAgICB9XG5cbiAgICAvLyBOQjogV2UgZG8gdGhpcyBiZWNhdXNlIHgtcmVxdWlyZSB3aWxsIGluY2x1ZGUgYW4gYWJzb2x1dGUgcGF0aCBmcm9tIHRoZVxuICAgIC8vIG9yaWdpbmFsIGJ1aWx0IGFwcCBhbmQgd2UgbmVlZCB0byBzdGlsbCBncm9rIGl0XG4gICAgaWYgKHRoaXMub3JpZ2luYWxBcHBSb290KSB7XG4gICAgICBjYWNoZUtleSA9IGNhY2hlS2V5LnJlcGxhY2UodGhpcy5vcmlnaW5hbEFwcFJvb3QsICcnKTtcbiAgICB9XG5cbiAgICBsZXQgY2FjaGVFbnRyeSA9IHRoaXMuY2hhbmdlQ2FjaGVbY2FjaGVLZXldO1xuXG4gICAgaWYgKHRoaXMuZmFpbE9uQ2FjaGVNaXNzKSB7XG4gICAgICBpZiAoIWNhY2hlRW50cnkpIHtcbiAgICAgICAgZChgVHJpZWQgdG8gcmVhZCBmaWxlIGNhY2hlIGVudHJ5IGZvciAke2Fic29sdXRlRmlsZVBhdGh9YCk7XG4gICAgICAgIGQoYGNhY2hlS2V5OiAke2NhY2hlS2V5fSwgYXBwUm9vdDogJHt0aGlzLmFwcFJvb3R9LCBvcmlnaW5hbEFwcFJvb3Q6ICR7dGhpcy5vcmlnaW5hbEFwcFJvb3R9YCk7XG4gICAgICAgIHRocm93IG5ldyBFcnJvcihgQXNrZWQgZm9yICR7YWJzb2x1dGVGaWxlUGF0aH0gYnV0IGl0IHdhcyBub3QgcHJlY29tcGlsZWQhYCk7XG4gICAgICB9XG4gICAgfVxuXG4gICAgcmV0dXJuIHtjYWNoZUVudHJ5LCBjYWNoZUtleX07XG4gIH1cblxuICAvKipcbiAgICogQ2hlY2tzIHRoZSBmaWxlIGNhY2hlIHRvIHNlZSBpZiBhIGZpbGUgaGFzIGNoYW5nZWQuXG4gICAqXG4gICAqIEBwYXJhbSAge3N0cmluZ30gYWJzb2x1dGVGaWxlUGF0aCAgVGhlIHBhdGggdG8gYSBmaWxlIHRvIHJldHJpZXZlIGluZm8gb24uXG4gICAqIEBwYXJhbSAge09iamVjdH0gY2FjaGVFbnRyeSAgQ2FjaGUgZGF0YSBmcm9tIHtAbGluayBnZXRDYWNoZUVudHJ5Rm9yUGF0aH1cbiAgICpcbiAgICogQHJldHVybiB7Ym9vbGVhbn1cbiAgICovXG4gIGFzeW5jIGhhc0ZpbGVDaGFuZ2VkKGFic29sdXRlRmlsZVBhdGgsIGNhY2hlRW50cnk9bnVsbCwgZmlsZUhhc2hJbmZvPW51bGwpIHtcbiAgICBjYWNoZUVudHJ5ID0gY2FjaGVFbnRyeSB8fCB0aGlzLmdldENhY2hlRW50cnlGb3JQYXRoKGFic29sdXRlRmlsZVBhdGgpLmNhY2hlRW50cnk7XG4gICAgZmlsZUhhc2hJbmZvID0gZmlsZUhhc2hJbmZvIHx8IGF3YWl0IHRoaXMuZ2V0SW5mb0ZvckNhY2hlRW50cnkoYWJzb2x1dGVGaWxlUGF0aCk7XG5cbiAgICBpZiAoY2FjaGVFbnRyeSkge1xuICAgICAgcmV0dXJuICEoY2FjaGVFbnRyeS5jdGltZSA+PSBmaWxlSGFzaEluZm8uY3RpbWUgJiYgY2FjaGVFbnRyeS5zaXplID09PSBmaWxlSGFzaEluZm8uc2l6ZSk7XG4gICAgfVxuXG4gICAgcmV0dXJuIGZhbHNlO1xuICB9XG5cbiAgLyoqXG4gICAqIFJldHVybnMgZGF0YSB0aGF0IGNhbiBwYXNzZWQgdG8ge0BsaW5rIGxvYWRGcm9tRGF0YX0gdG8gcmVoeWRyYXRlIHRoaXMgY2FjaGUuXG4gICAqXG4gICAqIEByZXR1cm4ge09iamVjdH1cbiAgICovXG4gIGdldFNhdmVkRGF0YSgpIHtcbiAgICByZXR1cm4geyBjaGFuZ2VDYWNoZTogdGhpcy5jaGFuZ2VDYWNoZSwgYXBwUm9vdDogdGhpcy5hcHBSb290IH07XG4gIH1cblxuICAvKipcbiAgICogU2VyaWFsaXplcyB0aGlzIG9iamVjdCdzIGRhdGEgdG8gYSBmaWxlLlxuICAgKlxuICAgKiBAcGFyYW0ge3N0cmluZ30gZmlsZVBhdGggIFRoZSBwYXRoIHRvIHNhdmUgZGF0YSB0by5cbiAgICpcbiAgICogQHJldHVybiB7UHJvbWlzZX0gQ29tcGxldGlvbi5cbiAgICovXG4gIGFzeW5jIHNhdmUoZmlsZVBhdGgpIHtcbiAgICBsZXQgdG9TYXZlID0gdGhpcy5nZXRTYXZlZERhdGEoKTtcblxuICAgIGxldCBidWYgPSBhd2FpdCBwemxpYi5nemlwKG5ldyBCdWZmZXIoSlNPTi5zdHJpbmdpZnkodG9TYXZlKSkpO1xuICAgIGF3YWl0IHBmcy53cml0ZUZpbGUoZmlsZVBhdGgsIGJ1Zik7XG4gIH1cblxuICBhc3luYyBjYWxjdWxhdGVIYXNoRm9yRmlsZShhYnNvbHV0ZUZpbGVQYXRoKSB7XG4gICAgbGV0IGJ1ZiA9IGF3YWl0IHBmcy5yZWFkRmlsZShhYnNvbHV0ZUZpbGVQYXRoKTtcbiAgICBsZXQgZW5jb2RpbmcgPSBGaWxlQ2hhbmdlZENhY2hlLmRldGVjdEZpbGVFbmNvZGluZyhidWYpO1xuXG4gICAgaWYgKCFlbmNvZGluZykge1xuICAgICAgbGV0IGRpZ2VzdCA9IGNyeXB0by5jcmVhdGVIYXNoKCdzaGExJykudXBkYXRlKGJ1ZikuZGlnZXN0KCdoZXgnKTtcbiAgICAgIHJldHVybiB7IHNvdXJjZUNvZGU6IG51bGwsIGRpZ2VzdCwgYmluYXJ5RGF0YTogYnVmIH07XG4gICAgfVxuXG4gICAgbGV0IHNvdXJjZUNvZGUgPSBhd2FpdCBwZnMucmVhZEZpbGUoYWJzb2x1dGVGaWxlUGF0aCwgZW5jb2RpbmcpO1xuICAgIGxldCBkaWdlc3QgPSBjcnlwdG8uY3JlYXRlSGFzaCgnc2hhMScpLnVwZGF0ZShzb3VyY2VDb2RlLCAndXRmOCcpLmRpZ2VzdCgnaGV4Jyk7XG5cbiAgICByZXR1cm4ge3NvdXJjZUNvZGUsIGRpZ2VzdCwgYmluYXJ5RGF0YTogbnVsbCB9O1xuICB9XG5cbiAgZ2V0SGFzaEZvclBhdGhTeW5jKGFic29sdXRlRmlsZVBhdGgpIHtcbiAgICBsZXQgY2FjaGVLZXkgPSBzYW5pdGl6ZUZpbGVQYXRoKGFic29sdXRlRmlsZVBhdGgpO1xuXG4gICAgaWYgKHRoaXMuYXBwUm9vdCkge1xuICAgICAgY2FjaGVLZXkgPSBGaWxlQ2hhbmdlZENhY2hlLnJlbW92ZVByZWZpeCh0aGlzLmFwcFJvb3QsIGNhY2hlS2V5KTtcbiAgICB9XG5cbiAgICAvLyBOQjogV2UgZG8gdGhpcyBiZWNhdXNlIHgtcmVxdWlyZSB3aWxsIGluY2x1ZGUgYW4gYWJzb2x1dGUgcGF0aCBmcm9tIHRoZVxuICAgIC8vIG9yaWdpbmFsIGJ1aWx0IGFwcCBhbmQgd2UgbmVlZCB0byBzdGlsbCBncm9rIGl0XG4gICAgaWYgKHRoaXMub3JpZ2luYWxBcHBSb290KSB7XG4gICAgICBjYWNoZUtleSA9IEZpbGVDaGFuZ2VkQ2FjaGUucmVtb3ZlUHJlZml4KHRoaXMub3JpZ2luYWxBcHBSb290LCBjYWNoZUtleSk7XG4gICAgfVxuXG4gICAgbGV0IGNhY2hlRW50cnkgPSB0aGlzLmNoYW5nZUNhY2hlW2NhY2hlS2V5XTtcblxuICAgIGlmICh0aGlzLmZhaWxPbkNhY2hlTWlzcykge1xuICAgICAgaWYgKCFjYWNoZUVudHJ5KSB7XG4gICAgICAgIGQoYFRyaWVkIHRvIHJlYWQgZmlsZSBjYWNoZSBlbnRyeSBmb3IgJHthYnNvbHV0ZUZpbGVQYXRofWApO1xuICAgICAgICBkKGBjYWNoZUtleTogJHtjYWNoZUtleX0sIGFwcFJvb3Q6ICR7dGhpcy5hcHBSb290fSwgb3JpZ2luYWxBcHBSb290OiAke3RoaXMub3JpZ2luYWxBcHBSb290fWApO1xuICAgICAgICB0aHJvdyBuZXcgRXJyb3IoYEFza2VkIGZvciAke2Fic29sdXRlRmlsZVBhdGh9IGJ1dCBpdCB3YXMgbm90IHByZWNvbXBpbGVkIWApO1xuICAgICAgfVxuXG4gICAgICByZXR1cm4gY2FjaGVFbnRyeS5pbmZvO1xuICAgIH1cblxuICAgIGxldCBzdGF0ID0gZnMuc3RhdFN5bmMoYWJzb2x1dGVGaWxlUGF0aCk7XG4gICAgbGV0IGN0aW1lID0gc3RhdC5jdGltZS5nZXRUaW1lKCk7XG4gICAgbGV0IHNpemUgPSBzdGF0LnNpemU7XG4gICAgaWYgKCFzdGF0IHx8ICFzdGF0LmlzRmlsZSgpKSB0aHJvdyBuZXcgRXJyb3IoYENhbid0IHN0YXQgJHthYnNvbHV0ZUZpbGVQYXRofWApO1xuXG4gICAgaWYgKGNhY2hlRW50cnkpIHtcbiAgICAgIGlmIChjYWNoZUVudHJ5LmN0aW1lID49IGN0aW1lICYmIGNhY2hlRW50cnkuc2l6ZSA9PT0gc2l6ZSkge1xuICAgICAgICByZXR1cm4gY2FjaGVFbnRyeS5pbmZvO1xuICAgICAgfVxuXG4gICAgICBkKGBJbnZhbGlkYXRpbmcgY2FjaGUgZW50cnk6ICR7Y2FjaGVFbnRyeS5jdGltZX0gPT09ICR7Y3RpbWV9ICYmICR7Y2FjaGVFbnRyeS5zaXplfSA9PT0gJHtzaXplfWApO1xuICAgICAgZGVsZXRlIHRoaXMuY2hhbmdlQ2FjaGUuY2FjaGVFbnRyeTtcbiAgICB9XG5cbiAgICBsZXQge2RpZ2VzdCwgc291cmNlQ29kZSwgYmluYXJ5RGF0YX0gPSB0aGlzLmNhbGN1bGF0ZUhhc2hGb3JGaWxlU3luYyhhYnNvbHV0ZUZpbGVQYXRoKTtcblxuICAgIGxldCBpbmZvID0ge1xuICAgICAgaGFzaDogZGlnZXN0LFxuICAgICAgaXNNaW5pZmllZDogRmlsZUNoYW5nZWRDYWNoZS5jb250ZW50c0FyZU1pbmlmaWVkKHNvdXJjZUNvZGUgfHwgJycpLFxuICAgICAgaXNJbk5vZGVNb2R1bGVzOiBGaWxlQ2hhbmdlZENhY2hlLmlzSW5Ob2RlTW9kdWxlcyhhYnNvbHV0ZUZpbGVQYXRoKSxcbiAgICAgIGhhc1NvdXJjZU1hcDogRmlsZUNoYW5nZWRDYWNoZS5oYXNTb3VyY2VNYXAoc291cmNlQ29kZSB8fCAnJyksXG4gICAgICBpc0ZpbGVCaW5hcnk6ICEhYmluYXJ5RGF0YVxuICAgIH07XG5cbiAgICB0aGlzLmNoYW5nZUNhY2hlW2NhY2hlS2V5XSA9IHsgY3RpbWUsIHNpemUsIGluZm8gfTtcbiAgICBkKGBDYWNoZSBlbnRyeSBmb3IgJHtjYWNoZUtleX06ICR7SlNPTi5zdHJpbmdpZnkodGhpcy5jaGFuZ2VDYWNoZVtjYWNoZUtleV0pfWApO1xuXG4gICAgaWYgKGJpbmFyeURhdGEpIHtcbiAgICAgIHJldHVybiBPYmplY3QuYXNzaWduKHtiaW5hcnlEYXRhfSwgaW5mbyk7XG4gICAgfSBlbHNlIHtcbiAgICAgIHJldHVybiBPYmplY3QuYXNzaWduKHtzb3VyY2VDb2RlfSwgaW5mbyk7XG4gICAgfVxuICB9XG5cbiAgc2F2ZVN5bmMoZmlsZVBhdGgpIHtcbiAgICBsZXQgdG9TYXZlID0gdGhpcy5nZXRTYXZlZERhdGEoKTtcblxuICAgIGxldCBidWYgPSB6bGliLmd6aXBTeW5jKG5ldyBCdWZmZXIoSlNPTi5zdHJpbmdpZnkodG9TYXZlKSkpO1xuICAgIGZzLndyaXRlRmlsZVN5bmMoZmlsZVBhdGgsIGJ1Zik7XG4gIH1cblxuICBjYWxjdWxhdGVIYXNoRm9yRmlsZVN5bmMoYWJzb2x1dGVGaWxlUGF0aCkge1xuICAgIGxldCBidWYgPSBmcy5yZWFkRmlsZVN5bmMoYWJzb2x1dGVGaWxlUGF0aCk7XG4gICAgbGV0IGVuY29kaW5nID0gRmlsZUNoYW5nZWRDYWNoZS5kZXRlY3RGaWxlRW5jb2RpbmcoYnVmKTtcblxuICAgIGlmICghZW5jb2RpbmcpIHtcbiAgICAgIGxldCBkaWdlc3QgPSBjcnlwdG8uY3JlYXRlSGFzaCgnc2hhMScpLnVwZGF0ZShidWYpLmRpZ2VzdCgnaGV4Jyk7XG4gICAgICByZXR1cm4geyBzb3VyY2VDb2RlOiBudWxsLCBkaWdlc3QsIGJpbmFyeURhdGE6IGJ1Zn07XG4gICAgfVxuXG4gICAgbGV0IHNvdXJjZUNvZGUgPSBmcy5yZWFkRmlsZVN5bmMoYWJzb2x1dGVGaWxlUGF0aCwgZW5jb2RpbmcpO1xuICAgIGxldCBkaWdlc3QgPSBjcnlwdG8uY3JlYXRlSGFzaCgnc2hhMScpLnVwZGF0ZShzb3VyY2VDb2RlLCAndXRmOCcpLmRpZ2VzdCgnaGV4Jyk7XG5cbiAgICByZXR1cm4ge3NvdXJjZUNvZGUsIGRpZ2VzdCwgYmluYXJ5RGF0YTogbnVsbH07XG4gIH1cblxuXG4gIC8qKlxuICAgKiBEZXRlcm1pbmVzIHZpYSBzb21lIHN0YXRpc3RpY3Mgd2hldGhlciBhIGZpbGUgaXMgbGlrZWx5IHRvIGJlIG1pbmlmaWVkLlxuICAgKlxuICAgKiBAcHJpdmF0ZVxuICAgKi9cbiAgc3RhdGljIGNvbnRlbnRzQXJlTWluaWZpZWQoc291cmNlKSB7XG4gICAgbGV0IGxlbmd0aCA9IHNvdXJjZS5sZW5ndGg7XG4gICAgaWYgKGxlbmd0aCA+IDEwMjQpIGxlbmd0aCA9IDEwMjQ7XG5cbiAgICBsZXQgbmV3bGluZUNvdW50ID0gMDtcblxuICAgIC8vIFJvbGwgdGhyb3VnaCB0aGUgY2hhcmFjdGVycyBhbmQgZGV0ZXJtaW5lIHRoZSBhdmVyYWdlIGxpbmUgbGVuZ3RoXG4gICAgZm9yKGxldCBpPTA7IGkgPCBzb3VyY2UubGVuZ3RoOyBpKyspIHtcbiAgICAgIGlmIChzb3VyY2VbaV0gPT09ICdcXG4nKSBuZXdsaW5lQ291bnQrKztcbiAgICB9XG5cbiAgICAvLyBObyBOZXdsaW5lcz8gQW55IGZpbGUgb3RoZXIgdGhhbiBhIHN1cGVyIHNtYWxsIG9uZSBpcyBtaW5pZmllZFxuICAgIGlmIChuZXdsaW5lQ291bnQgPT09IDApIHtcbiAgICAgIHJldHVybiAobGVuZ3RoID4gODApO1xuICAgIH1cblxuICAgIGxldCBhdmdMaW5lTGVuZ3RoID0gbGVuZ3RoIC8gbmV3bGluZUNvdW50O1xuICAgIHJldHVybiAoYXZnTGluZUxlbmd0aCA+IDgwKTtcbiAgfVxuXG5cbiAgLyoqXG4gICAqIERldGVybWluZXMgd2hldGhlciBhIHBhdGggaXMgaW4gbm9kZV9tb2R1bGVzIG9yIHRoZSBFbGVjdHJvbiBpbml0IGNvZGVcbiAgICpcbiAgICogQHByaXZhdGVcbiAgICovXG4gIHN0YXRpYyBpc0luTm9kZU1vZHVsZXMoZmlsZVBhdGgpIHtcbiAgICByZXR1cm4gISEoZmlsZVBhdGgubWF0Y2goLyhub2RlX21vZHVsZXN8Ym93ZXJfY29tcG9uZW50cylbXFxcXFxcL10vaSkgfHwgZmlsZVBhdGgubWF0Y2goLyhhdG9tfGVsZWN0cm9uKVxcLmFzYXIvKSk7XG4gIH1cblxuXG4gIC8qKlxuICAgKiBSZXR1cm5zIHdoZXRoZXIgYSBmaWxlIGhhcyBhbiBpbmxpbmUgc291cmNlIG1hcFxuICAgKlxuICAgKiBAcHJpdmF0ZVxuICAgKi9cbiAgc3RhdGljIGhhc1NvdXJjZU1hcChzb3VyY2VDb2RlKSB7XG4gICAgY29uc3QgdHJpbW1lZCA9IHNvdXJjZUNvZGUudHJpbSgpO1xuICAgIHJldHVybiB0cmltbWVkLmxhc3RJbmRleE9mKCcvLyMgc291cmNlTWFwJykgPiB0cmltbWVkLmxhc3RJbmRleE9mKCdcXG4nKTtcbiAgfVxuXG4gIC8qKlxuICAgKiBEZXRlcm1pbmVzIHRoZSBlbmNvZGluZyBvZiBhIGZpbGUgZnJvbSB0aGUgdHdvIG1vc3QgY29tbW9uIGVuY29kaW5ncyBieSB0cnlpbmdcbiAgICogdG8gZGVjb2RlIGl0IHRoZW4gbG9va2luZyBmb3IgZW5jb2RpbmcgZXJyb3JzXG4gICAqXG4gICAqIEBwcml2YXRlXG4gICAqL1xuICBzdGF0aWMgZGV0ZWN0RmlsZUVuY29kaW5nKGJ1ZmZlcikge1xuICAgIGlmIChidWZmZXIubGVuZ3RoIDwgMSkgcmV0dXJuIGZhbHNlO1xuICAgIGxldCBidWYgPSAoYnVmZmVyLmxlbmd0aCA8IDQwOTYgPyBidWZmZXIgOiBidWZmZXIuc2xpY2UoMCwgNDA5NikpO1xuXG4gICAgY29uc3QgZW5jb2RpbmdzID0gWyd1dGY4JywgJ3V0ZjE2bGUnXTtcblxuICAgIGxldCBlbmNvZGluZztcbiAgICBpZiAoYnVmZmVyLmxlbmd0aCA8PSAxMjgpIHtcbiAgICAgIGVuY29kaW5nID0gZW5jb2RpbmdzLmZpbmQoeCA9PlxuICAgICAgICBCdWZmZXIuY29tcGFyZShuZXcgQnVmZmVyKGJ1ZmZlci50b1N0cmluZygpLCB4KSwgYnVmZmVyKSA9PT0gMFxuICAgICAgKTtcbiAgICB9IGVsc2Uge1xuICAgICAgZW5jb2RpbmcgPSBlbmNvZGluZ3MuZmluZCh4ID0+ICFGaWxlQ2hhbmdlZENhY2hlLmNvbnRhaW5zQ29udHJvbENoYXJhY3RlcnMoYnVmLnRvU3RyaW5nKHgpKSk7XG4gICAgfVxuXG4gICAgcmV0dXJuIGVuY29kaW5nO1xuICB9XG5cbiAgLyoqXG4gICAqIERldGVybWluZXMgd2hldGhlciBhIHN0cmluZyBpcyBsaWtlbHkgdG8gYmUgcG9vcmx5IGVuY29kZWQgYnkgbG9va2luZyBmb3JcbiAgICogY29udHJvbCBjaGFyYWN0ZXJzIGFib3ZlIGEgY2VydGFpbiB0aHJlc2hvbGRcbiAgICpcbiAgICogQHByaXZhdGVcbiAgICovXG4gIHN0YXRpYyBjb250YWluc0NvbnRyb2xDaGFyYWN0ZXJzKHN0cikge1xuICAgIGxldCBjb250cm9sQ291bnQgPSAwO1xuICAgIGxldCBzcGFjZUNvdW50ID0gMDtcbiAgICBsZXQgdGhyZXNob2xkID0gMjtcbiAgICBpZiAoc3RyLmxlbmd0aCA+IDY0KSB0aHJlc2hvbGQgPSA0O1xuICAgIGlmIChzdHIubGVuZ3RoID4gNTEyKSB0aHJlc2hvbGQgPSA4O1xuXG4gICAgZm9yIChsZXQgaT0wOyBpIDwgc3RyLmxlbmd0aDsgaSsrKSB7XG4gICAgICBsZXQgYyA9IHN0ci5jaGFyQ29kZUF0KGkpO1xuICAgICAgaWYgKGMgPT09IDY1NTM2IHx8IGMgPCA4KSBjb250cm9sQ291bnQrKztcbiAgICAgIGlmIChjID4gMTQgJiYgYyA8IDMyKSBjb250cm9sQ291bnQrKztcbiAgICAgIGlmIChjID09PSAzMikgc3BhY2VDb3VudCsrO1xuXG4gICAgICBpZiAoY29udHJvbENvdW50ID4gdGhyZXNob2xkKSByZXR1cm4gdHJ1ZTtcbiAgICB9XG5cbiAgICBpZiAoc3BhY2VDb3VudCA8IHRocmVzaG9sZCkgcmV0dXJuIHRydWU7XG5cbiAgICBpZiAoY29udHJvbENvdW50ID09PSAwKSByZXR1cm4gZmFsc2U7XG4gICAgcmV0dXJuIChjb250cm9sQ291bnQgLyBzdHIubGVuZ3RoKSA8IDAuMDI7XG4gIH1cbn1cbiJdfQ==