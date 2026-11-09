/**
 * The pixelfx effects the app uses, by name. Imported by the FX worker (to
 * draw them) and by the page (for their sizes). Adding a moment = adding a
 * line here, then a function in moments.js.
 */
import * as arcaneOrb from 'pixelfx/fx/arcane/arcane-orb';
import * as collectBurst from 'pixelfx/fx/pickups/collect-burst';
import * as hitSpark from 'pixelfx/fx/impacts/hit-spark';
import * as blinds from 'pixelfx/fx/transitions/blinds';

export const EFFECTS = {
  'arcane-orb': arcaneOrb,
  'collect-burst': collectBurst,
  'hit-spark': hitSpark,
  blinds,
};
