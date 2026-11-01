.. _command-palette:

Command palette
===============

The command palette lets you reach any table, database, page or common action
from the keyboard: open it, type a few letters, press :kbd:`Enter`. It is a
BetterMyAdmin addition; phpMyAdmin has no equivalent.

Opening it
----------

* Press :kbd:`Ctrl+Shift+P` (:kbd:`Cmd+Shift+P` on macOS), anywhere, also
  while typing in a form field or the SQL editor. Press it again to close.
* Or click the search button at the right of the top bar, next to the user
  menu.

:kbd:`Ctrl+K` stays the console toggle, as in phpMyAdmin. The keyboard shortcut
follows :config:option:`$cfg['DisableShortcutKeys']`; the button is always
there. Firefox keeps :kbd:`Ctrl+Shift+P` for a private window, so use the
button there.

What it lists
-------------

With nothing typed, the palette shows, from the top:

* **Recently visited tables** (the navigation panel's *Recent* list);
* the **tabs of the current page level** (Server, Database or Table: SQL,
  Search, Export, Import, Operations, Privileges, Status, Variables, …,
  only those you can use);
* **Actions**: Home, Settings, Toggle console, Log out;
* **Theme** and its colour modes;
* the **tables** of the current database and the **databases** of the server.

Typing filters and ranks everything at once. Letters only have to appear in
order, so ``custl`` finds ``customer_list``; matches at the start of a word
and runs of consecutive letters come first. Tables and databases are searched
on the server, across every database you can see (the
:config:option:`$cfg['Servers'][$i]['only_db']` and
:config:option:`$cfg['Servers'][$i]['hide_db']` settings apply), so this stays
fast on servers with thousands of tables; only the best matches are shown.
Type ``database.table`` (for example ``shop.ord``) to look in one database.
With :config:option:`$cfg['Servers'][$i]['DisableIS']` the table search covers
the current database and the one named before the dot.

Choosing an entry
-----------------

Use :kbd:`↑` and :kbd:`↓` to move (the list wraps around), :kbd:`Enter` or a
click to choose, :kbd:`Esc` to close without doing anything. A table opens on
its *Browse* page, a database on its *Structure* page, a tab or action does
what its link in the interface does. The focus goes back to where it was.

For developers
--------------

Features add their own entries through the palette's command registry
(``registerCommands()`` and the ``useRegisterCommands()`` React hook in
``apps/web/src/features/shell/palette/registry.ts``); see
:ref:`developers`.
