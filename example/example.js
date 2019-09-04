const jsnx = require('jsnetworkx')
const swarm = require('..')

const TO_SPAWN = 2

const G = new jsnx.DiGraph()
const peersTitle = document.getElementById('peers-title')
const connectionsTitle = document.getElementById('connections-title')
const peers = new Set()
const deletedPeers = new Set()
const connections = new Set()

bootstrap().then(draw)

async function bootstrap () {
  let toSpawn = TO_SPAWN
  while (toSpawn--) {
    createPeer()
  }
}

function findPeer(id) {
  let peer = Array.from(peers.values()).find(p => p.id.toString('hex').includes(id))
  if (peer) {
    return peer
  }

  peer = Array.from(deletedPeers.values()).find(p => p.id.toString('hex').includes(id))
  if (peer) {
    peer.deleted = true
    return peer
  }
}

function addPeer (peer) {
  if (!peers.has(peer)) {
    peers.add(peer)
    G.addNode(peer.id.toString('hex'))
    peersTitle.innerHTML = peers.size
  }
}

function getConnection (sw, info) {
  const connection = [sw.id.toString('hex'), info.id.toString('hex')]

  if (info.initiator) {
    return connection
  }

  return connection.reverse()
}

function createPeer () {
  const sw = swarm({
    bootstrap: ['localhost:4000']
  })

  sw.on('connection', (peer, info) => {
    try {
      const connection = getConnection(sw, info)
      connections.add(connection.join(':'))
      G.addEdge(connection[0], connection[1])
    } catch (err) {}
    connectionsTitle.innerHTML = connections.size
  })

  sw.on('connection-closed', (peer, info) => {
    try {
      const connection = getConnection(sw, info)
      connections.delete(connection.join(':'))
      G.removeEdge(connection[0], connection[1])
    } catch (err) {}
    connectionsTitle.innerHTML = connections.size
  })

  sw.on('error', (err, info) => {
    //console.log(err.code, info.id.toString('hex'))
  })

  sw.join(Buffer.from('0011', 'hex'))

  addPeer(sw)

  return sw
}

function deletePeer () {
  if (peers.size === 0) return
  const peer = Array.from(peers.values()).reverse().pop()
  peers.delete(peer)
  deletedPeers.add(peer)
  G.addNode(peer.id.toString('hex'))
  peer.leave(Buffer.from('0011', 'hex'))
  peersTitle.innerHTML = peers.size
}

function draw () {
  jsnx.draw(G, {
    element: '#canvas',
    layoutAttr: {
      linkDistance: 100
    },
    withLabels: true,
    labels: (d) => d.node.slice(0, 4),
    nodeStyle: {
      fill: d => {
        if (findPeer(d.node).deleted) {
          return 'red'
        }

        return 'white'
      },
      strokeWidth: 4,
      stroke: (d) => {
        if (findPeer(d.node).deleted) {
          return 'red'
        }

        const mostSignificant = parseInt(d.node.slice(0, 2), 16)
        const percent = mostSignificant / 255
        const hue = percent * 360
        return `hsl(${hue}, 100%, 50%)`
      }
    },
    nodeAttr: {
      r: 16
    },
    stickyDrag: true
  }, true)
}

document.getElementById('add-peer').addEventListener('click', () => {
  createPeer()
})

document.getElementById('remove-peer').addEventListener('click', () => {
  deletePeer()
})

const addMany = n => [...Array(n).keys()].forEach(() => createPeer())
const deleteMany = n => [...Array(n).keys()].forEach(() => deletePeer())
window.addMany = addMany
window.deleteMany = deleteMany
window.simulate = () => {
  addMany(3)
  deleteMany(2)
}
document.getElementById('add-many-peers').addEventListener('click', () => {
  addMany(25)
})

document.getElementById('remove-many-peers').addEventListener('click', () => {
  deleteMany(25)
})

window.findPeer = findPeer
