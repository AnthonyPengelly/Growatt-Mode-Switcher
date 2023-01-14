# GROWATT Switcher with Octopus

Finds the 6 lowest time periods from Agile Octopus. Then sets the hybrid inverter to fill the battery from the grid during these times.

Designed to run at around 11:30pm to set up the inverter for the following day.

## ENV Variables

USERNAME: email address for Growatt

PASSWORD: password for Growatt

SERIAL_NUMBER: Serial number of hybrid inverter

COST_THRESHOLD: Number of pence under which to turn on the inverter
