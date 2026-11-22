// Act 2 - The Light

# SCENE lamp_room — The Lamp Room
@bg lamp_room_dark   @music storm_rising

The great lens is cold. Out on the water, a single mast light rises and falls.

?? if $found_log
You remember the log: the wick. You pull the spare from your coat.
?? end

WREN: Someone has to hold the ladder. Someone has to climb.

?? if $wren_trust >= 6
WREN (steady): You climb. I've got you.
?? else
WREN: I'll climb. Just... stay out of the way.
?? end

* [Climb while Wren holds the ladder] -> .dawn {requires $wren_trust >= 6; else disabled}
* [Let Wren climb alone] -> .alone

## dawn — Dawn Together
The lamp catches. A beam sweeps the water and finds the Gull, turning for home.
WREN: Figures. Took two of us.
END dawn "Dawn Together"

## alone — The Long Dark
Wren gets the lamp lit, but she doesn't look at you again all night.
END alone "The Long Dark"
