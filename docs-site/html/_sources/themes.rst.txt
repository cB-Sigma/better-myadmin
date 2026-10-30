.. _themes:

Custom Themes
=============

BetterMyAdmin comes with seven themes, each with a light and a dark variant:

* phpMyAdmin's four themes: ``pmahomme`` (the default), ``original``,
  ``metro`` (with its colour modes) and ``bootstrap``;
* three themes of BetterMyAdmin's own: ``modern``, in the style of shadcn/ui;
  ``classic``, pmahomme refreshed in a flat, compact style; and ``native``,
  the look of a native database client.

The colour mode follows the operating system's light or dark preference by
default, and can be chosen by hand.

Configuration
-------------

Themes are configured with :config:option:`$cfg['ThemeManager']` and
:config:option:`$cfg['ThemeDefault']` (``pmahomme`` unless you set another
one; an unknown name falls back to it). If
:config:option:`$cfg['ThemeManager']` is enabled, you can select your favorite
theme and its colour mode from the Appearance settings of the main page or
from the theme gallery. Your selection is remembered by the browser, and the
default theme you choose is stored in your user preferences.
:config:option:`$cfg['ThemePerServer']` allows a different theme for each
server.

Creating custom theme
---------------------

In phpMyAdmin a theme is a folder of CSS, SCSS and image files under
:file:`./public/themes/`, with a :file:`theme.json` describing it, and you
can add your own or download third party themes from phpMyAdmin's website.

BetterMyAdmin's themes are not folders on the server: each theme is a set of
design tokens (colours, fonts, spacing, corners) compiled into the
application, so phpMyAdmin's theme folders cannot be loaded and there is no
"Get more themes" link. To create a theme, add a token set to the source code
(:file:`packages/ui/src/themes/` in the repository) and build BetterMyAdmin;
see the `UI design system
<https://github.com/cB-Sigma/better-myadmin/blob/main/docs/architecture/09-ui-design-system.md>`_
documentation.

Theme metadata
++++++++++++++

Each theme keeps the metadata of phpMyAdmin's :file:`theme.json` (shown in the
theme gallery):

.. describe:: name

    Display name of the theme.

.. describe:: version

    Theme version, can be quite arbitrary and does not have to match
    BetterMyAdmin's version.

.. describe:: description

    Theme description.

.. describe:: author

    Theme author name.

.. describe:: url

    Link to theme author website.

.. describe:: supports

    Array of supported phpMyAdmin major versions.

For example, the definition for Original theme:

.. code-block:: json

    {
        "name": "Original",
        "version": "6.0",
        "description": "Original phpMyAdmin theme",
        "author": "phpMyAdmin developers",
        "url": "https://www.phpmyadmin.net/",
        "supports": ["6.0"]
    }
