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
const addPeer = () => _addPeer(graph, TOPIC, {
  bootstrap: ['ws://localhost:4000', 'ws://localhost:5000']
})
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
  .nodeColor(node => node.destroyed ? 'red' : null)
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
