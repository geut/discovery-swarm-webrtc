# discovery-swarm-webrtc
A swarm-based implementation of the [simple-server](https://github.com/t-mullen/simple-signal) signal service, compatible with the [simple-peer](https://github.com/feross/simple-peer) WebRTC wrapper.

## Running the Signal Server

```
$ git clone git@github.com:wirelineio/discovery-swarm-webrtc.git
$ cd discovery-swarm-webrtc
$ git checkout new-webrtc-swarm
$ yarn
$ yarn start
```

## Install

```
$ npm install @geut/discovery-swarm-webrtc@alpha
```

## Usage

### Server

You can run your own signal server by running:

```
$ discovery-signal-webrtc --port=3300
```

#### Deploy to Heroku

[![Deploy](https://www.herokucdn.com/deploy/button.svg)](https://heroku.com/deploy)

### Client

```javascript
const swarm = require('@geut/discovery-swarm-webrtc')

const sw = swarm({
  id: 'id',
  urls: ['localhost:3300'],
  stream: () => feed.replicate()
})

sw.join('topic')

sw.on('connection', peer => {
  // connected
})
```

## API

#### `const sw = swarm(opts)`

Creates a new Swarm. Options include:

```javascript
{
  id: cuid(), // peer-id for user
  urls: [string], // urls to your socket.io endpoints
  stream: stream, // stream to replicate across peers
  simplePeer: {}, // options to your simplePeer instances
}
```

#### `sw.join(topic)`

Join a specific channel. We use behind it `simple-signal` + `simple-peer`.

### Events

#### `sw.on('handshaking', function(connection, info) { ... })`

Emitted when you've connected to a peer and are now initializing the connection's session. Info is an object that contains info about the connection.

``` js
{
  id // the remote peer's peer-id.
  channel // the channel
}
```

#### `sw.on('connection', function(connection, info) { ... })`

Emitted when you have fully connected to another peer. Info is an object that contains info about the connection.

#### `sw.on('connection-closed', function(connection, info) { ... })`

Emitted when you've disconnected from a peer. Info is an object that contains info about the connection.
