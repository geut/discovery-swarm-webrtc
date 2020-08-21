const { SocketSignalWebsocketServer } = require('socket-signal-websocket')

// Backward compatibility with v2
module.exports = (...args) => new SocketSignalWebsocketServer(...args)
module.exports.SignalServer = SocketSignalWebsocketServer
