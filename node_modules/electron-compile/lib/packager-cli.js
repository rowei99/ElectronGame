#!/usr/bin/env node
'use strict';

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.packagerMain = exports.runAsarArchive = exports.packageDirToResourcesDir = undefined;

let packageDirToResourcesDir = exports.packageDirToResourcesDir = (() => {
  var _ref = _asyncToGenerator(function* (packageDir) {
    let appDir = (yield _promise.pfs.readdir(packageDir)).find(function (x) {
      return x.match(/\.app$/i);
    });
    if (appDir) {
      return _path2.default.join(packageDir, appDir, 'Contents', 'Resources', 'app');
    } else {
      return _path2.default.join(packageDir, 'resources', 'app');
    }
  });

  return function packageDirToResourcesDir(_x) {
    return _ref.apply(this, arguments);
  };
})();

let copySmallFile = (() => {
  var _ref2 = _asyncToGenerator(function* (from, to) {
    d(`Copying ${from} => ${to}`);

    let buf = yield _promise.pfs.readFile(from);
    yield _promise.pfs.writeFile(to, buf);
  });

  return function copySmallFile(_x2, _x3) {
    return _ref2.apply(this, arguments);
  };
})();

let compileAndShim = (() => {
  var _ref3 = _asyncToGenerator(function* (packageDir) {
    let appDir = yield packageDirToResourcesDir(packageDir);

    d(`Looking in ${appDir}`);
    for (let entry of yield _promise.pfs.readdir(appDir)) {
      if (entry.match(/^(node_modules|bower_components)$/)) continue;

      let fullPath = _path2.default.join(appDir, entry);
      let stat = yield _promise.pfs.stat(fullPath);

      if (!stat.isDirectory()) continue;

      d(`Executing electron-compile: ${appDir} => ${entry}`);
      yield (0, _cli.main)(appDir, [fullPath]);
    }

    d('Copying in es6-shim');
    let packageJson = JSON.parse((yield _promise.pfs.readFile(_path2.default.join(appDir, 'package.json'), 'utf8')));

    let index = packageJson.main || 'index.js';
    packageJson.originalMain = index;
    packageJson.main = 'es6-shim.js';

    yield copySmallFile(_path2.default.join(__dirname, 'es6-shim.js'), _path2.default.join(appDir, 'es6-shim.js'));

    yield _promise.pfs.writeFile(_path2.default.join(appDir, 'package.json'), JSON.stringify(packageJson, null, 2));
  });

  return function compileAndShim(_x4) {
    return _ref3.apply(this, arguments);
  };
})();

let runAsarArchive = exports.runAsarArchive = (() => {
  var _ref4 = _asyncToGenerator(function* (packageDir, asarUnpackDir) {
    let appDir = yield packageDirToResourcesDir(packageDir);

    let asarArgs = ['pack', 'app', 'app.asar'];
    if (asarUnpackDir) {
      asarArgs.push('--unpack-dir', asarUnpackDir);
    }

    var _findExecutableOrGues = findExecutableOrGuess('asar', asarArgs);

    let cmd = _findExecutableOrGues.cmd,
        args = _findExecutableOrGues.args;


    d(`Running ${cmd} ${JSON.stringify(args)}`);
    yield (0, _spawnRx.spawnPromise)(cmd, args, { cwd: _path2.default.join(appDir, '..') });
    _rimraf2.default.sync(_path2.default.join(appDir));
  });

  return function runAsarArchive(_x5, _x6) {
    return _ref4.apply(this, arguments);
  };
})();

let packagerMain = exports.packagerMain = (() => {
  var _ref5 = _asyncToGenerator(function* (argv) {
    d(`argv: ${JSON.stringify(argv)}`);
    argv = argv.splice(2);

    var _splitOutAsarArgument = splitOutAsarArguments(argv);

    let packagerArgs = _splitOutAsarArgument.packagerArgs,
        asarArgs = _splitOutAsarArgument.asarArgs;

    var _findExecutableOrGues2 = findExecutableOrGuess(electronPackager, packagerArgs);

    let cmd = _findExecutableOrGues2.cmd,
        args = _findExecutableOrGues2.args;


    d(`Spawning electron-packager: ${JSON.stringify(args)}`);
    let packagerOutput = yield (0, _spawnRx.spawnPromise)(cmd, args);
    let packageDirs = parsePackagerOutput(packagerOutput);

    d(`Starting compilation for ${JSON.stringify(packageDirs)}`);
    for (let packageDir of packageDirs) {
      yield compileAndShim(packageDir);

      if (!asarArgs) continue;

      d('Starting ASAR packaging');
      let asarUnpackDir = null;
      if (asarArgs.length === 2) {
        asarUnpackDir = asarArgs[1];
      }

      yield runAsarArchive(packageDir, asarUnpackDir);
    }
  });

  return function packagerMain(_x7) {
    return _ref5.apply(this, arguments);
  };
})();

exports.splitOutAsarArguments = splitOutAsarArguments;
exports.parsePackagerOutput = parsePackagerOutput;
exports.findExecutableOrGuess = findExecutableOrGuess;

var _path = require('path');

var _path2 = _interopRequireDefault(_path);

var _rimraf = require('rimraf');

var _rimraf2 = _interopRequireDefault(_rimraf);

var _promise = require('./promise');

var _cli = require('./cli');

var _spawnRx = require('spawn-rx');

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

function _asyncToGenerator(fn) { return function () { var gen = fn.apply(this, arguments); return new Promise(function (resolve, reject) { function step(key, arg) { try { var info = gen[key](arg); var value = info.value; } catch (error) { reject(error); return; } if (info.done) { resolve(value); } else { return Promise.resolve(value).then(function (value) { step("next", value); }, function (err) { step("throw", err); }); } } return step("next"); }); }; }

const d = require('debug')('electron-compile:packager');
const electronPackager = 'electron-packager';

function splitOutAsarArguments(argv) {
  if (argv.find(x => x.match(/^--asar-unpack$/))) {
    throw new Error("electron-compile doesn't support --asar-unpack at the moment, use asar-unpack-dir");
  }

  // Strip --asar altogether
  let ret = argv.filter(x => !x.match(/^--asar/));

  if (ret.length === argv.length) {
    return { packagerArgs: ret, asarArgs: null };
  }

  let indexOfUnpack = ret.findIndex(x => x.match(/^--asar-unpack-dir$/));
  if (indexOfUnpack < 0) {
    return { packagerArgs: ret, asarArgs: [] };
  }

  let unpackArgs = ret.slice(indexOfUnpack, indexOfUnpack + 1);
  let notUnpackArgs = ret.slice(0, indexOfUnpack).concat(ret.slice(indexOfUnpack + 2));

  return { packagerArgs: notUnpackArgs, asarArgs: unpackArgs };
}

function parsePackagerOutput(output) {
  // NB: Yes, this is fragile as fuck. :-/
  console.log(output);
  let lines = output.split('\n');

  let idx = lines.findIndex(x => x.match(/Wrote new app/i));
  if (idx < 1) throw new Error(`Packager output is invalid: ${output}`);
  lines = lines.splice(idx);

  // Multi-platform case
  if (lines[0].match(/Wrote new apps/)) {
    return lines.splice(1).filter(x => x.length > 1);
  } else {
    return [lines[0].replace(/^.*new app to /, '')];
  }
}

function findExecutableOrGuess(cmdToFind, argsToUse) {
  var _findActualExecutable = (0, _spawnRx.findActualExecutable)(cmdToFind, argsToUse);

  let cmd = _findActualExecutable.cmd,
      args = _findActualExecutable.args;

  if (cmd === electronPackager) {
    d(`Can't find ${cmdToFind}, falling back to where it should be as a guess!`);
    let cmdSuffix = process.platform === 'win32' ? '.cmd' : '';
    return (0, _spawnRx.findActualExecutable)(_path2.default.resolve(__dirname, '..', '..', '.bin', `${cmdToFind}${cmdSuffix}`), argsToUse);
  }

  return { cmd, args };
}

if (process.mainModule === module) {
  packagerMain(process.argv).then(() => process.exit(0)).catch(e => {
    console.error(e.message || e);
    d(e.stack);

    process.exit(-1);
  });
}
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJzb3VyY2VzIjpbIi4uL3NyYy9wYWNrYWdlci1jbGkuanMiXSwibmFtZXMiOlsicGFja2FnZURpciIsImFwcERpciIsInJlYWRkaXIiLCJmaW5kIiwieCIsIm1hdGNoIiwiam9pbiIsInBhY2thZ2VEaXJUb1Jlc291cmNlc0RpciIsImZyb20iLCJ0byIsImQiLCJidWYiLCJyZWFkRmlsZSIsIndyaXRlRmlsZSIsImNvcHlTbWFsbEZpbGUiLCJlbnRyeSIsImZ1bGxQYXRoIiwic3RhdCIsImlzRGlyZWN0b3J5IiwicGFja2FnZUpzb24iLCJKU09OIiwicGFyc2UiLCJpbmRleCIsIm1haW4iLCJvcmlnaW5hbE1haW4iLCJfX2Rpcm5hbWUiLCJzdHJpbmdpZnkiLCJjb21waWxlQW5kU2hpbSIsImFzYXJVbnBhY2tEaXIiLCJhc2FyQXJncyIsInB1c2giLCJmaW5kRXhlY3V0YWJsZU9yR3Vlc3MiLCJjbWQiLCJhcmdzIiwiY3dkIiwic3luYyIsInJ1bkFzYXJBcmNoaXZlIiwiYXJndiIsInNwbGljZSIsInNwbGl0T3V0QXNhckFyZ3VtZW50cyIsInBhY2thZ2VyQXJncyIsImVsZWN0cm9uUGFja2FnZXIiLCJwYWNrYWdlck91dHB1dCIsInBhY2thZ2VEaXJzIiwicGFyc2VQYWNrYWdlck91dHB1dCIsImxlbmd0aCIsInBhY2thZ2VyTWFpbiIsInJlcXVpcmUiLCJFcnJvciIsInJldCIsImZpbHRlciIsImluZGV4T2ZVbnBhY2siLCJmaW5kSW5kZXgiLCJ1bnBhY2tBcmdzIiwic2xpY2UiLCJub3RVbnBhY2tBcmdzIiwiY29uY2F0Iiwib3V0cHV0IiwiY29uc29sZSIsImxvZyIsImxpbmVzIiwic3BsaXQiLCJpZHgiLCJyZXBsYWNlIiwiY21kVG9GaW5kIiwiYXJnc1RvVXNlIiwiY21kU3VmZml4IiwicHJvY2VzcyIsInBsYXRmb3JtIiwicmVzb2x2ZSIsIm1haW5Nb2R1bGUiLCJtb2R1bGUiLCJ0aGVuIiwiZXhpdCIsImNhdGNoIiwiZSIsImVycm9yIiwibWVzc2FnZSIsInN0YWNr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LG1DQUFxQkQsU0FBckIsRUFBZ0NDLFNBQWhDLENBRHNDOztBQUFBLE1BQ3BEakMsR0FEb0QseUJBQ3BEQSxHQURvRDtBQUFBLE1BQy9DQyxJQUQrQyx5QkFDL0NBLElBRCtDOztBQUUxRCxNQUFJRCxRQUFRUyxnQkFBWixFQUE4QjtBQUM1Qi9CLE1BQUcsY0FBYXNELFNBQVUsa0RBQTFCO0FBQ0EsUUFBSUUsWUFBWUMsUUFBUUMsUUFBUixLQUFxQixPQUFyQixHQUErQixNQUEvQixHQUF3QyxFQUF4RDtBQUNBLFdBQU8sbUNBQXFCLGVBQUtDLE9BQUwsQ0FBYTVDLFNBQWIsRUFBd0IsSUFBeEIsRUFBOEIsSUFBOUIsRUFBb0MsTUFBcEMsRUFBNkMsR0FBRXVDLFNBQVUsR0FBRUUsU0FBVSxFQUFyRSxDQUFyQixFQUE4RkQsU0FBOUYsQ0FBUDtBQUNEOztBQUVELFNBQU8sRUFBRWpDLEdBQUYsRUFBT0MsSUFBUCxFQUFQO0FBQ0Q7O0FBNkJELElBQUlrQyxRQUFRRyxVQUFSLEtBQXVCQyxNQUEzQixFQUFtQztBQUNqQ3pCLGVBQWFxQixRQUFROUIsSUFBckIsRUFDR21DLElBREgsQ0FDUSxNQUFNTCxRQUFRTSxJQUFSLENBQWEsQ0FBYixDQURkLEVBRUdDLEtBRkgsQ0FFVUMsQ0FBRCxJQUFPO0FBQ1pqQixZQUFRa0IsS0FBUixDQUFjRCxFQUFFRSxPQUFGLElBQWFGLENBQTNCO0FBQ0FqRSxNQUFFaUUsRUFBRUcsS0FBSjs7QUFFQVgsWUFBUU0sSUFBUixDQUFhLENBQUMsQ0FBZDtBQUNELEdBUEg7QUFRRCIsImZpbGUiOiJwYWNrYWdlci1jbGkuanMiLCJzb3VyY2VzQ29udGVudCI6WyJcblxuaW1wb3J0IHBhdGggZnJvbSAncGF0aCc7XG5pbXBvcnQgcmltcmFmIGZyb20gJ3JpbXJhZic7XG5cbmltcG9ydCB7cGZzfSBmcm9tICcuL3Byb21pc2UnO1xuaW1wb3J0IHttYWlufSBmcm9tICcuL2NsaSc7XG5cbmltcG9ydCB7c3Bhd25Qcm9taXNlLCBmaW5kQWN0dWFsRXhlY3V0YWJsZX0gZnJvbSAnc3Bhd24tcngnO1xuXG5jb25zdCBkID0gcmVxdWlyZSgnZGVidWcnKSgnZWxlY3Ryb24tY29tcGlsZTpwYWNrYWdlcicpO1xuY29uc3QgZWxlY3Ryb25QYWNrYWdlciA9ICdlbGVjdHJvbi1wYWNrYWdlcic7XG5cbmV4cG9ydCBhc3luYyBmdW5jdGlvbiBwYWNrYWdlRGlyVG9SZXNvdXJjZXNEaXIocGFja2FnZURpcikge1xuICBsZXQgYXBwRGlyID0gKGF3YWl0IHBmcy5yZWFkZGlyKHBhY2thZ2VEaXIpKS5maW5kKCh4KSA9PiB4Lm1hdGNoKC9cXC5hcHAkL2kpKTtcbiAgaWYgKGFwcERpcikge1xuICAgIHJldHVybiBwYXRoLmpvaW4ocGFja2FnZURpciwgYXBwRGlyLCAnQ29udGVudHMnLCAnUmVzb3VyY2VzJywgJ2FwcCcpO1xuICB9IGVsc2Uge1xuICAgIHJldHVybiBwYXRoLmpvaW4ocGFja2FnZURpciwgJ3Jlc291cmNlcycsICdhcHAnKTtcbiAgfVxufVxuXG5hc3luYyBmdW5jdGlvbiBjb3B5U21hbGxGaWxlKGZyb20sIHRvKSB7XG4gIGQoYENvcHlpbmcgJHtmcm9tfSA9PiAke3RvfWApO1xuXG4gIGxldCBidWYgPSBhd2FpdCBwZnMucmVhZEZpbGUoZnJvbSk7XG4gIGF3YWl0IHBmcy53cml0ZUZpbGUodG8sIGJ1Zik7XG59XG5cbmV4cG9ydCBmdW5jdGlvbiBzcGxpdE91dEFzYXJBcmd1bWVudHMoYXJndikge1xuICBpZiAoYXJndi5maW5kKCh4KSA9PiB4Lm1hdGNoKC9eLS1hc2FyLXVucGFjayQvKSkpIHtcbiAgICB0aHJvdyBuZXcgRXJyb3IoXCJlbGVjdHJvbi1jb21waWxlIGRvZXNuJ3Qgc3VwcG9ydCAtLWFzYXItdW5wYWNrIGF0IHRoZSBtb21lbnQsIHVzZSBhc2FyLXVucGFjay1kaXJcIik7XG4gIH1cblxuICAvLyBTdHJpcCAtLWFzYXIgYWx0b2dldGhlclxuICBsZXQgcmV0ID0gYXJndi5maWx0ZXIoKHgpID0+ICF4Lm1hdGNoKC9eLS1hc2FyLykpO1xuXG4gIGlmIChyZXQubGVuZ3RoID09PSBhcmd2Lmxlbmd0aCkgeyByZXR1cm4geyBwYWNrYWdlckFyZ3M6IHJldCwgYXNhckFyZ3M6IG51bGwgfTsgfVxuXG4gIGxldCBpbmRleE9mVW5wYWNrID0gcmV0LmZpbmRJbmRleCgoeCkgPT4geC5tYXRjaCgvXi0tYXNhci11bnBhY2stZGlyJC8pKTtcbiAgaWYgKGluZGV4T2ZVbnBhY2sgPCAwKSB7XG4gICAgcmV0dXJuIHsgcGFja2FnZXJBcmdzOiByZXQsIGFzYXJBcmdzOiBbXSB9O1xuICB9XG5cbiAgbGV0IHVucGFja0FyZ3MgPSByZXQuc2xpY2UoaW5kZXhPZlVucGFjaywgaW5kZXhPZlVucGFjaysxKTtcbiAgbGV0IG5vdFVucGFja0FyZ3MgPSByZXQuc2xpY2UoMCwgaW5kZXhPZlVucGFjaykuY29uY2F0KHJldC5zbGljZShpbmRleE9mVW5wYWNrKzIpKTtcblxuICByZXR1cm4geyBwYWNrYWdlckFyZ3M6IG5vdFVucGFja0FyZ3MsIGFzYXJBcmdzOiB1bnBhY2tBcmdzIH07XG59XG5cbmV4cG9ydCBmdW5jdGlvbiBwYXJzZVBhY2thZ2VyT3V0cHV0KG91dHB1dCkge1xuICAvLyBOQjogWWVzLCB0aGlzIGlzIGZyYWdpbGUgYXMgZnVjay4gOi0vXG4gIGNvbnNvbGUubG9nKG91dHB1dCk7XG4gIGxldCBsaW5lcyA9IG91dHB1dC5zcGxpdCgnXFxuJyk7XG5cbiAgbGV0IGlkeCA9IGxpbmVzLmZpbmRJbmRleCgoeCkgPT4geC5tYXRjaCgvV3JvdGUgbmV3IGFwcC9pKSk7XG4gIGlmIChpZHggPCAxKSB0aHJvdyBuZXcgRXJyb3IoYFBhY2thZ2VyIG91dHB1dCBpcyBpbnZhbGlkOiAke291dHB1dH1gKTtcbiAgbGluZXMgPSBsaW5lcy5zcGxpY2UoaWR4KTtcblxuICAvLyBNdWx0aS1wbGF0Zm9ybSBjYXNlXG4gIGlmIChsaW5lc1swXS5tYXRjaCgvV3JvdGUgbmV3IGFwcHMvKSkge1xuICAgIHJldHVybiBsaW5lcy5zcGxpY2UoMSkuZmlsdGVyKCh4KSA9PiB4Lmxlbmd0aCA+IDEpO1xuICB9IGVsc2Uge1xuICAgIHJldHVybiBbbGluZXNbMF0ucmVwbGFjZSgvXi4qbmV3IGFwcCB0byAvLCAnJyldO1xuICB9XG59XG5cbmFzeW5jIGZ1bmN0aW9uIGNvbXBpbGVBbmRTaGltKHBhY2thZ2VEaXIpIHtcbiAgbGV0IGFwcERpciA9IGF3YWl0IHBhY2thZ2VEaXJUb1Jlc291cmNlc0RpcihwYWNrYWdlRGlyKTtcblxuICBkKGBMb29raW5nIGluICR7YXBwRGlyfWApO1xuICBmb3IgKGxldCBlbnRyeSBvZiBhd2FpdCBwZnMucmVhZGRpcihhcHBEaXIpKSB7XG4gICAgaWYgKGVudHJ5Lm1hdGNoKC9eKG5vZGVfbW9kdWxlc3xib3dlcl9jb21wb25lbnRzKSQvKSkgY29udGludWU7XG5cbiAgICBsZXQgZnVsbFBhdGggPSBwYXRoLmpvaW4oYXBwRGlyLCBlbnRyeSk7XG4gICAgbGV0IHN0YXQgPSBhd2FpdCBwZnMuc3RhdChmdWxsUGF0aCk7XG5cbiAgICBpZiAoIXN0YXQuaXNEaXJlY3RvcnkoKSkgY29udGludWU7XG5cbiAgICBkKGBFeGVjdXRpbmcgZWxlY3Ryb24tY29tcGlsZTogJHthcHBEaXJ9ID0+ICR7ZW50cnl9YCk7XG4gICAgYXdhaXQgbWFpbihhcHBEaXIsIFtmdWxsUGF0aF0pO1xuICB9XG5cbiAgZCgnQ29weWluZyBpbiBlczYtc2hpbScpO1xuICBsZXQgcGFja2FnZUpzb24gPSBKU09OLnBhcnNlKFxuICAgIGF3YWl0IHBmcy5yZWFkRmlsZShwYXRoLmpvaW4oYXBwRGlyLCAncGFja2FnZS5qc29uJyksICd1dGY4JykpO1xuXG4gIGxldCBpbmRleCA9IHBhY2thZ2VKc29uLm1haW4gfHwgJ2luZGV4LmpzJztcbiAgcGFja2FnZUpzb24ub3JpZ2luYWxNYWluID0gaW5kZXg7XG4gIHBhY2thZ2VKc29uLm1haW4gPSAnZXM2LXNoaW0uanMnO1xuXG4gIGF3YWl0IGNvcHlTbWFsbEZpbGUoXG4gICAgcGF0aC5qb2luKF9fZGlybmFtZSwgJ2VzNi1zaGltLmpzJyksXG4gICAgcGF0aC5qb2luKGFwcERpciwgJ2VzNi1zaGltLmpzJykpO1xuXG4gIGF3YWl0IHBmcy53cml0ZUZpbGUoXG4gICAgcGF0aC5qb2luKGFwcERpciwgJ3BhY2thZ2UuanNvbicpLFxuICAgIEpTT04uc3RyaW5naWZ5KHBhY2thZ2VKc29uLCBudWxsLCAyKSk7XG59XG5cbmV4cG9ydCBhc3luYyBmdW5jdGlvbiBydW5Bc2FyQXJjaGl2ZShwYWNrYWdlRGlyLCBhc2FyVW5wYWNrRGlyKSB7XG4gIGxldCBhcHBEaXIgPSBhd2FpdCBwYWNrYWdlRGlyVG9SZXNvdXJjZXNEaXIocGFja2FnZURpcik7XG5cbiAgbGV0IGFzYXJBcmdzID0gWydwYWNrJywgJ2FwcCcsICdhcHAuYXNhciddO1xuICBpZiAoYXNhclVucGFja0Rpcikge1xuICAgIGFzYXJBcmdzLnB1c2goJy0tdW5wYWNrLWRpcicsIGFzYXJVbnBhY2tEaXIpO1xuICB9XG5cbiAgbGV0IHsgY21kLCBhcmdzIH0gPSBmaW5kRXhlY3V0YWJsZU9yR3Vlc3MoJ2FzYXInLCBhc2FyQXJncyk7XG5cbiAgZChgUnVubmluZyAke2NtZH0gJHtKU09OLnN0cmluZ2lmeShhcmdzKX1gKTtcbiAgYXdhaXQgc3Bhd25Qcm9taXNlKGNtZCwgYXJncywgeyBjd2Q6IHBhdGguam9pbihhcHBEaXIsICcuLicpIH0pO1xuICByaW1yYWYuc3luYyhwYXRoLmpvaW4oYXBwRGlyKSk7XG59XG5cbmV4cG9ydCBmdW5jdGlvbiBmaW5kRXhlY3V0YWJsZU9yR3Vlc3MoY21kVG9GaW5kLCBhcmdzVG9Vc2UpIHtcbiAgbGV0IHsgY21kLCBhcmdzIH0gPSBmaW5kQWN0dWFsRXhlY3V0YWJsZShjbWRUb0ZpbmQsIGFyZ3NUb1VzZSk7XG4gIGlmIChjbWQgPT09IGVsZWN0cm9uUGFja2FnZXIpIHtcbiAgICBkKGBDYW4ndCBmaW5kICR7Y21kVG9GaW5kfSwgZmFsbGluZyBiYWNrIHRvIHdoZXJlIGl0IHNob3VsZCBiZSBhcyBhIGd1ZXNzIWApO1xuICAgIGxldCBjbWRTdWZmaXggPSBwcm9jZXNzLnBsYXRmb3JtID09PSAnd2luMzInID8gJy5jbWQnIDogJyc7XG4gICAgcmV0dXJuIGZpbmRBY3R1YWxFeGVjdXRhYmxlKHBhdGgucmVzb2x2ZShfX2Rpcm5hbWUsICcuLicsICcuLicsICcuYmluJywgYCR7Y21kVG9GaW5kfSR7Y21kU3VmZml4fWApLCBhcmdzVG9Vc2UpO1xuICB9XG5cbiAgcmV0dXJuIHsgY21kLCBhcmdzIH07XG59XG5cbmV4cG9ydCBhc3luYyBmdW5jdGlvbiBwYWNrYWdlck1haW4oYXJndikge1xuICBkKGBhcmd2OiAke0pTT04uc3RyaW5naWZ5KGFyZ3YpfWApO1xuICBhcmd2ID0gYXJndi5zcGxpY2UoMik7XG5cbiAgbGV0IHsgcGFja2FnZXJBcmdzLCBhc2FyQXJncyB9ID0gc3BsaXRPdXRBc2FyQXJndW1lbnRzKGFyZ3YpO1xuICBsZXQgeyBjbWQsIGFyZ3MgfSA9IGZpbmRFeGVjdXRhYmxlT3JHdWVzcyhlbGVjdHJvblBhY2thZ2VyLCBwYWNrYWdlckFyZ3MpO1xuXG4gIGQoYFNwYXduaW5nIGVsZWN0cm9uLXBhY2thZ2VyOiAke0pTT04uc3RyaW5naWZ5KGFyZ3MpfWApO1xuICBsZXQgcGFja2FnZXJPdXRwdXQgPSBhd2FpdCBzcGF3blByb21pc2UoY21kLCBhcmdzKTtcbiAgbGV0IHBhY2thZ2VEaXJzID0gcGFyc2VQYWNrYWdlck91dHB1dChwYWNrYWdlck91dHB1dCk7XG5cbiAgZChgU3RhcnRpbmcgY29tcGlsYXRpb24gZm9yICR7SlNPTi5zdHJpbmdpZnkocGFja2FnZURpcnMpfWApO1xuICBmb3IgKGxldCBwYWNrYWdlRGlyIG9mIHBhY2thZ2VEaXJzKSB7XG4gICAgYXdhaXQgY29tcGlsZUFuZFNoaW0ocGFja2FnZURpcik7XG5cbiAgICBpZiAoIWFzYXJBcmdzKSBjb250aW51ZTtcblxuICAgIGQoJ1N0YXJ0aW5nIEFTQVIgcGFja2FnaW5nJyk7XG4gICAgbGV0IGFzYXJVbnBhY2tEaXIgPSBudWxsO1xuICAgIGlmIChhc2FyQXJncy5sZW5ndGggPT09IDIpIHtcbiAgICAgIGFzYXJVbnBhY2tEaXIgPSBhc2FyQXJnc1sxXTtcbiAgICB9XG5cbiAgICBhd2FpdCBydW5Bc2FyQXJjaGl2ZShwYWNrYWdlRGlyLCBhc2FyVW5wYWNrRGlyKTtcbiAgfVxufVxuXG5pZiAocHJvY2Vzcy5tYWluTW9kdWxlID09PSBtb2R1bGUpIHtcbiAgcGFja2FnZXJNYWluKHByb2Nlc3MuYXJndilcbiAgICAudGhlbigoKSA9PiBwcm9jZXNzLmV4aXQoMCkpXG4gICAgLmNhdGNoKChlKSA9PiB7XG4gICAgICBjb25zb2xlLmVycm9yKGUubWVzc2FnZSB8fCBlKTtcbiAgICAgIGQoZS5zdGFjayk7XG5cbiAgICAgIHByb2Nlc3MuZXhpdCgtMSk7XG4gICAgfSk7XG59XG4iXX0=