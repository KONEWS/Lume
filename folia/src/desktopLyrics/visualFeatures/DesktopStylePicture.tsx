import stylePicturescadenza from './stylePictures/cadenza.png';
import stylePicturescappella from './stylePictures/cappella.png';
import stylePicturescladdagh from './stylePictures/claddagh.png';
import stylePicturesclassic from './stylePictures/classic.png';
import stylePicturesdiorama from './stylePictures/diorama.png';
import stylePicturesfume from './stylePictures/fume.png';
import stylePictureshanabi from './stylePictures/hanabi.png';
import stylePictureslumiere from './stylePictures/lumiere.png';
import stylePicturesmachi from './stylePictures/machi.png';
import stylePicturesmetaphor from './stylePictures/metaphor.png';
import stylePicturesmonet from './stylePictures/monet.png';
import stylePicturesnebbia from './stylePictures/nebbia.png';
import stylePicturespartita from './stylePictures/partita.png';
import stylePicturespendolo from './stylePictures/pendolo.png';
import stylePicturessonnet from './stylePictures/sonnet.png';
import stylePicturesstill from './stylePictures/still.png';
import stylePicturestempera from './stylePictures/tempera.png';
import stylePicturestilt from './stylePictures/tilt.png';
import backgroundPicturescommon from './backgroundPictures/common.png';
import backgroundPictureslatent from './backgroundPictures/latent.png';
import backgroundPicturesmonet from './backgroundPictures/monet.png';
import backgroundPicturesnomand from './backgroundPictures/nomand.png';
import backgroundPicturessora from './backgroundPictures/sora.png';
import { Shuffle } from 'lucide-react';
import type { VisualizerMode, VisualizerBackgroundMode } from '../../types';
import { VisualizerModeGlyph, BackgroundModeGlyph } from '../../components/visualizer/modeGlyphs';
import { RANDOM_VISUALIZER_CHOICE } from '../../components/visualizer/random/lyricStyleChoices';

// Desktop choices show shipped posters; hovering and selecting never mount another renderer.
const pictures = {'./stylePictures/cadenza.png':stylePicturescadenza,'./stylePictures/cappella.png':stylePicturescappella,'./stylePictures/claddagh.png':stylePicturescladdagh,'./stylePictures/classic.png':stylePicturesclassic,'./stylePictures/diorama.png':stylePicturesdiorama,'./stylePictures/fume.png':stylePicturesfume,'./stylePictures/hanabi.png':stylePictureshanabi,'./stylePictures/lumiere.png':stylePictureslumiere,'./stylePictures/machi.png':stylePicturesmachi,'./stylePictures/metaphor.png':stylePicturesmetaphor,'./stylePictures/monet.png':stylePicturesmonet,'./stylePictures/nebbia.png':stylePicturesnebbia,'./stylePictures/partita.png':stylePicturespartita,'./stylePictures/pendolo.png':stylePicturespendolo,'./stylePictures/sonnet.png':stylePicturessonnet,'./stylePictures/still.png':stylePicturesstill,'./stylePictures/tempera.png':stylePicturestempera,'./stylePictures/tilt.png':stylePicturestilt};
const backgrounds = {'./backgroundPictures/common.png':backgroundPicturescommon,'./backgroundPictures/latent.png':backgroundPictureslatent,'./backgroundPictures/monet.png':backgroundPicturesmonet,'./backgroundPictures/nomand.png':backgroundPicturesnomand,'./backgroundPictures/sora.png':backgroundPicturessora};

export function drawDesktopStylePicture(mode: VisualizerMode) {
    if (mode === RANDOM_VISUALIZER_CHOICE) return <span className="grid h-full w-full place-items-center text-[color:var(--st-accent)]"><Shuffle size={24}/></span>;
    const source = pictures[`./stylePictures/${mode}.png`];
    return source ? <img src={source} alt="" draggable={false} className="h-full w-full object-cover"/> :
        <span className="grid h-full w-full place-items-center text-[color:var(--st-t2)]"><VisualizerModeGlyph mode={mode} size={22}/></span>;
}

export function drawDesktopBackgroundPicture(mode: VisualizerBackgroundMode) {
    const source = backgrounds[`./backgroundPictures/${mode}.png`];
    return source ? <img src={source} alt="" draggable={false} className="h-full w-full object-cover"/> :
        <span className="grid h-full w-full place-items-center text-[color:var(--st-t2)]"><BackgroundModeGlyph mode={mode} size={22}/></span>;
}
