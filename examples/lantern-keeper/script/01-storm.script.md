// Act 1 - The Storm

# SCENE arrival — Arrival at the Lighthouse
@bg lighthouse_door_storm   @music storm_low   @ambience rain_heavy

Rain comes sideways off the sea. The lighthouse door swings open before you can knock.

@portrait wren wary
WREN: Figures. The one night the oil runs dry, somebody shows up.
WREN (looking past you): You're soaked. Get in before the wind takes the door.

* [Offer to help with the lantern] -> stairs {do <<stat "wren_trust" 2>>}
* [Ask where the oil is kept] -> cellar
* [Say nothing and wait] -> stairs {do <<stat "wren_trust" -1>>}

# SCENE stairs — The Long Stair
@bg spiral_stair

One hundred and twelve steps. Wren counts them under her breath.

WREN: My brother's out there. The Gull. He was due back at sundown.
WREN (quiet): Why do you think I'm still up?

* [Promise you'll get the light going] -> lamp_room {do <<stat "wren_trust" 2>>}
* [Tell her he's probably safe in a harbour] -> lamp_room {do <<stat "wren_trust" -1>>}

# SCENE cellar — The Cellar
@bg cellar_lantern   @ambience drip_loop

The cellar smells of tar and salt. Two oil drums stand by the far wall, and a ledger lies open on a crate.

* [Read the ledger] -> .ledger
* [Roll a drum to the stairs] -> lamp_room {do <<stat "wren_trust" 1>>}
* [Go back out into the storm to check the boats] -> .rocks

## ledger — The Keeper's Log
> set $found_log = true
The last entry is three days old. //Lantern wick fraying. Must replace before the equinox storms.//
-> lamp_room [Take the log upstairs]

## rocks — Outside
The wind lifts you off your feet. The last thing you see is the dark tower, unlit.
END wrecked "Lost to the Rocks"
