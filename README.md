# discovery-swarm-webrtc

[![Build Status](https://travis-ci.com/geut/discovery-swarm-webrtc.svg?branch=master)](https://travis-ci.com/geut/discovery-swarm-webrtc)
[![JavaScript Style Guide](https://img.shields.io/badge/code_style-standard-brightgreen.svg)](https://standardjs.com)

> discovery-swarm for webrtc

This module provides a "similar" API to discovery-swarm but for WebRTC connections.

It has a few differences to discovery-swarm:

- It needs a signaling server. We give you [one](#server).
- It uses [mmst](https://github.com/RangerMauve/mostly-minimal-spanning-tree) to minimize the connections. Check the example.
- `join` and `leave` only accepts Buffers.
- `leave` and `close` returns a Promise.

## Install

```
$ npm install @geut/discovery-swarm-webrtc
```

## Usage

### <a name="server"></a>Server

You can run your own signal server by running:

```
$ discovery-signal-webrtc --port=4000
```

#### Deploy to Heroku

[![Deploy](https://www.herokucdn.com/deploy/button.svg)](https://heroku.com/deploy)

### Client

```javascript
const swarm = require('@geut/discovery-swarm-webrtc')

const sw = swarm({
  bootstrap: ['localhost:4000']
})

sw.join(Buffer.from('some-topic'))

sw.on('connection', peer => {
  // connected
})
```

## API

#### `const sw = swarm(opts)`

Creates a new Swarm.

`opts` include:

```javascript
{
  id: crypto.randomBytes(32), // peer-id for user
  bootstrap: [string], // urls to your socket.io endpoints
  stream: (info) => stream, // stream to replicate across peers
  simplePeer: {}, // options for the simplePeer instances,
  maxPeers: 4, // max connections by peer
  connectionTimeout: 10 * 1000, // defines the time to wait to establish a connection,
  requestTimeout: 5 * 1000 // defines the time to wait for the result of a request to the server
}
```

#### `sw.join(Buffer)`

Join a specific channel. We use behind it `simple-signal` + `simple-peer`.

#### `sw.leave(Buffer) -> Promise`

Leave from specific channel. Destroy all the connections and leave the channel.

#### `sw.close() -> Promise`

Close the entire swarm. Destroy all the connections and disconnect from the signal.

### Events

#### `sw.on('handshaking', function(connection, info) { ... })`

Emitted when you've connected to a peer and are now initializing the connection's session. Info is an object that contains information about the connection.

`info` include:

``` js
{
  id: Buffer // the remote peer's peer-id.
  channel: Buffer // the channel this connection was initiated on.
  initiator: Boolean // whether we initiated the connection or someone else did
}
```

#### `sw.on('connection', function(connection, info) { ... })`

Emitted when you have fully connected to another peer. Info is an object that contains info about the connection.

#### `sw.on('connection-closed', function(connection, info) { ... })`

Emitted when you've disconnected from a peer. Info is an object that contains info about the connection.

#### `sw.on('close', function() { ... })`

Emitted when the swarm was closed.

#### `sw.on('candidates', function(channel, candidates) { ... })`

Emitted when the candidates peer for a specific channel was updated. `candidates` is an array of Buffer id.

## <a name="issues"></a> Issues

:bug: If you found an issue we encourage you to report it on [github](https://github.com/geut/moleculer-browser/issues). Please specify your OS and the actions to reproduce it.

## <a name="contribute"></a> Contributing

:busts_in_silhouette: Ideas and contributions to the project are welcome. You must follow this [guideline](https://github.com/geut/moleculer-browser/blob/master/CONTRIBUTING.md).

## License

MIT © A [**GEUT**](http://geutstudio.com/) project
