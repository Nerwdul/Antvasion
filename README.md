# Antvasion

Antvasion is a small desktop strategy game built with Electron. Choose a meteor landing spot and watch scouts spread to buildings. Each building needs 100 ants to become infected; its workers carry supplies back to the meteor.

After five buildings are infected, blue exterminators arrive in increasingly frequent, larger waves. They remove two nest points per second from infected buildings. When a nest is destroyed, it releases 100 workers that flee to the nearest other uninfected building with room; if none is available, they run around and keep looking. Exterminators pursue fleeing workers, dealing 2 damage per attack to all workers within a small area. Workers have 4 health.

The destroyed building turns blue and gains 100 protection points. Each arriving ant removes one point and is used up; once the protection is gone, another 100 ants are needed to reinfect it. Click the meteor (or the Meteor button) to recruit a soldier for 50 supplies. Soldiers automatically intercept exterminators. Soldiers have 5 health and deal 1 damage per second; exterminators have 100 health and deal 2 damage per second.

Use **WASD** or the arrow keys to move the map and scroll to zoom, both when choosing a meteor landing spot and during play.
During play, ants appear as tiny red dots at a distance and as pixel-art ants when zoomed in. Soldier dots are dark red; workers carrying supplies show a light-colored bundle up close.

## Run the desktop app

1. Install [Node.js](https://nodejs.org/).
2. Open this folder in a terminal and run `npm install`.
3. Run `npm start`, or double-click `Launch Antvasion.bat` after installing dependencies.

The main menu has **Start Game**, **Settings**, and **Quit**. Start Game lets you either generate a random town or type an address; the address is geocoded (OpenStreetMap Nominatim) and an approximately 1 × 1 mile map centered on it is loaded (Overpass API, internet required) and drawn in the style of a street map. Difficulty changes the ants' spawn and movement speeds. During a game, the map fills the window, pause is in the top-left, and the right-side Troops and Speed menus let you spawn soldiers and choose 1x, 1.5x, 2x, 3x, 5x, 10x, or 20x speed. Difficulty and sound settings are saved on this computer.

The loading screen shows map-drawing progress for both town types. Address searches show an indeterminate indicator while waiting for online services, and loading can be canceled.
