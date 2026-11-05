// Match the player's established theme and tablet/desktop boundary.
const theme = {}
require('node:vm').runInNewContext(require('node:fs').readFileSync(__dirname + '/public/music/js/ui/tailwind_setup.js', 'utf8'), { tailwind: theme })
module.exports = {
  ...theme.config,
  content: ['./public/music/**/*.html', './public/music/app.js', './public/music/js/**/*.js'],
  safelist: [
    { pattern: /^(bg|text|border|ring)-(red|orange|amber|yellow|green|emerald|teal|cyan|blue|indigo|violet|purple|pink|gray|slate)-(50|100|200|300|400|500|600|700|800|900|950)$/, variants: ['hover', 'dark'] },
  ],
}
