-- MariaDB ships ARCHIVE as a plugin (MySQL has it built in): the export suites' seed uses it.
INSTALL SONAME 'ha_archive';
