const crypto = require('crypto')
const createGraph = require('ngraph.graph')
const ForceGraph = require('force-graph').default
const { addPeer: _addPeer, removePeer: _removePeer, findPeer } = require('../tests/helpers/peers')
const { nodesToArray } = require('../tests/helpers/graph')

const MAX_PEERS = 2
const TOPIC = crypto.randomBytes(32)

const graph = createGraph()
const peersTitle = document.getElementById('peers-title')
const connectionsTitle = document.getElementById('connections-title')
function random (min, max) {
  return Math.floor(Math.random() * (max - min)) + min
}
const urls = [
  { url: 'ws://localhost:4000', color: 'green' },
  { url: 'ws://localhost:4001', color: 'black' },
  { url: 'ws://localhost:4002', color: 'blue' },
  { url: 'ws://localhost:4003', color: 'yellow' },
  { url: 'ws://localhost:4004', color: 'cyan' }
]
const addPeer = () => {
  const url = urls[random(0, urls.length)]
  const peer = _addPeer(graph, TOPIC, {
    bootstrap: [url.url]
  })
  peer.color = url.color
  return peer
}
const removePeer = (id) => _removePeer(graph, id)
const addMany = n => [...Array(n).keys()].forEach(() => addPeer())
const deleteMany = n => [...Array(n).keys()].forEach(() => removePeer())

window.graph = graph
window.findPeer = id => findPeer(graph, id)

document.getElementById('add-peer').addEventListener('click', () => {
  addPeer()
})

document.getElementById('remove-peer').addEventListener('click', () => {
  removePeer()
})

document.getElementById('add-many-peers').addEventListener('click', () => {
  addMany(25)
})

document.getElementById('remove-many-peers').addEventListener('click', () => {
  deleteMany(25)
})

const view = ForceGraph()(document.getElementById('graph'))

view
  .linkDirectionalParticles(2)
  .nodeVal(4)
  .nodeLabel('id')
  .nodeColor(node => {
    return node.destroyed ? 'red' : findPeer(graph, node.id).data.color
  })
  .graphData({ nodes: [], links: [] })

graph.on('changed', (changes) => {
  peersTitle.innerHTML = nodesToArray(graph).filter(n => !n.data._destroyed).length
  connectionsTitle.innerHTML = graph.getLinksCount()
  const { nodes: oldNodes, links: oldLinks } = view.graphData()

  const newNodes = []
  const newLinks = []
  changes.forEach(({ changeType, node, link }) => {
    if (changeType === 'add') {
      if (node) {
        newNodes.push({ id: node.id })
      } else {
        newLinks.push({ source: link.fromId, target: link.toId })
      }
      return
    }

    if (changeType === 'remove') {
      if (node) {
        const toDelete = oldNodes.find(n => n.id === node.id)
        toDelete.destroyed = true
      } else {
        const toDelete = oldLinks.findIndex(n => n.source.id === link.fromId && n.target.id === link.toId)
        if (toDelete !== -1) oldLinks.splice(toDelete, 1)
      }
    }
  })

  view.graphData({
    nodes: [...oldNodes, ...newNodes],
    links: [...oldLinks, ...newLinks]
  })
})

for (let i = 0; i < MAX_PEERS; i++) {
  addPeer()
}
