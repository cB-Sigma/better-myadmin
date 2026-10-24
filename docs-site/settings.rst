Configuring BetterMyAdmin
-------------------------

There are many configuration settings that can be used to customize the
interface. Those settings are described in
:ref:`config`. There are several layers of the configuration.

The global settings can be configured in the configuration file
(:file:`bettermyadmin.config.json` or one of the other formats), the Docker
variables or ``BMA__…`` environment variables, as described in
:ref:`config`. This is only way to configure connections to databases and other
system wide settings.

On top of this there are user settings which can be persistently stored in
:ref:`linked-tables`, possibly automatically configured through
:ref:`zeroconf`. If the :ref:`linked-tables` are not configured, BetterMyAdmin
keeps them in its local metadata store in :config:option:`$cfg['DataDir']` on
the server (phpMyAdmin keeps them only until you log out).

You can also save the user configuration for further use, either download them
as a JSON file (:file:`BetterMyAdmin-config-<host>.json`) or to the browser
local storage. You can find both those options in the :guilabel:`Settings` tab.
phpMyAdmin's "Save as PHP file" option is not offered. The settings stored in
browser local storage will be automatically offered for loading upon your login
to BetterMyAdmin.
