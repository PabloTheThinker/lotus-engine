// Vektra example plugin — paste into Plugin Manager or install via devtools:
// vektra.installPlugin(<paste this entire file>)

registerPlugin({
  name: 'Hello World',
  commands: [
    {
      label: 'Greet',
      run: () => vektra.useEditor.getState().setStatus('Hello from the Hello World plugin!'),
    },
  ],
  panels: [{ id: 'hello-panel', title: '👋 Hello' }],
  nodeTypes: [
    {
      type: 'hello-marker',
      label: 'Hello Marker',
      icon: '👋',
      category: 'Plugins',
      factory: (pos) => ({
        id: 'actor_' + Math.random().toString(36).slice(2, 10),
        name: 'HelloMarker',
        type: 'Empty',
        parentId: null,
        visible: true,
        transform: { position: pos, rotation: [0, 0, 0], scale: [1, 1, 1] },
        behaviors: [],
      }),
    },
  ],
  consoleCommands: [
    {
      name: 'hello',
      help: 'hello [name] — greet someone in the status bar',
      run: (args) => {
        const who = args.join(' ') || 'World'
        vektra.useEditor.getState().setStatus('Hello, ' + who + '!')
        return 'Hello, ' + who + '!'
      },
    },
  ],
  importers: [
    {
      ext: '.txt',
      label: 'Text to Console',
      import: (file) =>
        file.text().then((t) => {
          vektra.useEditor.getState().pushConsole('log', t.slice(0, 800))
        }),
    },
  ],
})

registerPanelCallback('hello-panel', (el) => {
  el.innerHTML =
    '<div style="padding:12px;font-family:system-ui;color:#9cf">' +
    '<h3 style="margin:0 0 8px">Hello Panel</h3>' +
    '<p style="margin:0;color:#8a9bb5">Drag a .txt file onto the viewport to log its contents.</p>' +
    '<p style="margin:8px 0 0;color:#8a9bb5">Try the <code>hello</code> console command or place a Hello Marker.</p>' +
    '</div>'
})