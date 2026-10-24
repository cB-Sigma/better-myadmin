# BetterMyAdmin demo

This codespace runs the latest BetterMyAdmin release with a MySQL 8.4 server that holds
`acme_store`, a small demo shop. BetterMyAdmin opens in a new browser tab; if it does
not, open the **Ports** panel and click the globe next to **BetterMyAdmin**.

You are logged in as MySQL `root` (config authentication), so feel free to break things: delete the
codespace and create a new one to start over. Things to try:

- `acme_store › orders › Browse`: click a `customer_id` to follow the foreign key, double-click a cell
  to edit it in place
- `acme_store › SQL`: run a query, then *Create JS code* or *Display chart*
- `acme_store › Designer` (under *More* on a narrow window): the tables and their relations; drag them around
- Home › Appearance: switch between the pmahomme, Modern, Classic and Native themes, light or dark

Installing it for real: [installation guide](https://cb-sigma.github.io/better-myadmin/setup.html).
