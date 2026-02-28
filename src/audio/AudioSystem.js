export class AudioSystem {
    constructor() {
        this.ctx = null;
        this.initialized = false;
        this.bgmOscillator = null;
        this.bgmGain = null;
        this.masterGain = null;
        this.masterVolume = 1.0;
    }

    init() {
        if (this.initialized) return;
        this.ctx = new (window.AudioContext || window.webkitAudioContext)();
        this.masterGain = this.ctx.createGain();
        this.masterGain.gain.value = this.masterVolume;
        this.masterGain.connect(this.ctx.destination);
        this.initialized = true;

        this.startBGM();
    }

    get destination() {
        return this.masterGain || this.ctx?.destination;
    }

    setVolume(v) {
        this.masterVolume = v;
        if (this.masterGain) {
            this.masterGain.gain.value = v;
        }
    }

    startBGM() {
        // BGM disabled — raw oscillators caused buzzing/humming on many PC sound cards
    }

    dispose() {
        if (this.ctx && this.ctx.state !== 'closed') {
            this.ctx.close();
        }
    }

    _createNoiseBuffer(durationStr = 0.5) {
        if (!this.ctx) return null;
        const bufferSize = this.ctx.sampleRate * durationStr;
        const buffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
        const data = buffer.getChannelData(0);
        for (let i = 0; i < bufferSize; i++) {
            data[i] = Math.random() * 2 - 1;
        }
        return buffer;
    }

    playFootstep() {
        if (!this.ctx) return;
        const buffer = this._createNoiseBuffer(0.1);
        const source = this.ctx.createBufferSource();
        source.buffer = buffer;

        // Filter the noise to sound like a dull thud/step
        const filter = this.ctx.createBiquadFilter();
        filter.type = 'lowpass';
        // Randomize cutoff slightly for variation
        filter.frequency.value = 300 + Math.random() * 200;

        const gainNode = this.ctx.createGain();
        // Envelope: quick attack, quick decay
        gainNode.gain.setValueAtTime(0, this.ctx.currentTime);
        gainNode.gain.linearRampToValueAtTime(0.3, this.ctx.currentTime + 0.01);
        gainNode.gain.exponentialRampToValueAtTime(0.01, this.ctx.currentTime + 0.1);

        source.connect(filter);
        filter.connect(gainNode);
        gainNode.connect(this.destination);

        source.start();
        source.stop(this.ctx.currentTime + 0.1);
    }

    playBlockBreak() {
        if (!this.ctx) return;
        const buffer = this._createNoiseBuffer(0.3);
        const source = this.ctx.createBufferSource();
        source.buffer = buffer;

        // Crunchier sound
        const filter = this.ctx.createBiquadFilter();
        filter.type = 'lowpass';
        // Sweep filter down
        filter.frequency.setValueAtTime(4000, this.ctx.currentTime);
        filter.frequency.exponentialRampToValueAtTime(400, this.ctx.currentTime + 0.2);

        const gainNode = this.ctx.createGain();
        gainNode.gain.setValueAtTime(0, this.ctx.currentTime);
        gainNode.gain.linearRampToValueAtTime(0.4, this.ctx.currentTime + 0.02);
        gainNode.gain.exponentialRampToValueAtTime(0.01, this.ctx.currentTime + 0.25);

        source.connect(filter);
        filter.connect(gainNode);
        gainNode.connect(this.destination);

        source.start();
        source.stop(this.ctx.currentTime + 0.3);
    }

    playBlockPlace() {
        if (!this.ctx) return;
        const buffer = this._createNoiseBuffer(0.2);
        const source = this.ctx.createBufferSource();
        source.buffer = buffer;

        // Softer impact
        const filter = this.ctx.createBiquadFilter();
        filter.type = 'lowpass';
        filter.frequency.value = 800;

        const gainNode = this.ctx.createGain();
        gainNode.gain.setValueAtTime(0, this.ctx.currentTime);
        gainNode.gain.linearRampToValueAtTime(0.3, this.ctx.currentTime + 0.02);
        gainNode.gain.exponentialRampToValueAtTime(0.01, this.ctx.currentTime + 0.15);

        source.connect(filter);
        filter.connect(gainNode);
        gainNode.connect(this.destination);

        source.start();
        source.stop(this.ctx.currentTime + 0.2);
    }

    playHit() {
        if (!this.ctx) return;

        const osc = this.ctx.createOscillator();
        osc.type = 'square';

        const filter = this.ctx.createBiquadFilter();
        filter.type = 'lowpass';
        filter.frequency.setValueAtTime(2000, this.ctx.currentTime);
        filter.frequency.exponentialRampToValueAtTime(100, this.ctx.currentTime + 0.1);

        const gainNode = this.ctx.createGain();
        gainNode.gain.setValueAtTime(0, this.ctx.currentTime);
        gainNode.gain.linearRampToValueAtTime(0.4, this.ctx.currentTime + 0.01);
        gainNode.gain.exponentialRampToValueAtTime(0.01, this.ctx.currentTime + 0.15);

        // Pitch envelope
        osc.frequency.setValueAtTime(400, this.ctx.currentTime);
        osc.frequency.exponentialRampToValueAtTime(100, this.ctx.currentTime + 0.1);

        osc.connect(filter);
        filter.connect(gainNode);
        gainNode.connect(this.destination);

        osc.start();
        osc.stop(this.ctx.currentTime + 0.15);
    }

    playPickup() {
        if (!this.ctx) return;

        const osc = this.ctx.createOscillator();
        osc.type = 'sine';

        const gainNode = this.ctx.createGain();
        gainNode.gain.setValueAtTime(0, this.ctx.currentTime);
        gainNode.gain.linearRampToValueAtTime(0.3, this.ctx.currentTime + 0.02);
        gainNode.gain.exponentialRampToValueAtTime(0.01, this.ctx.currentTime + 0.15);

        // Rising pitch "ding"
        osc.frequency.setValueAtTime(600, this.ctx.currentTime);
        osc.frequency.linearRampToValueAtTime(1200, this.ctx.currentTime + 0.1);

        osc.connect(gainNode);
        gainNode.connect(this.destination);

        osc.start();
        osc.stop(this.ctx.currentTime + 0.15);
    }

    playDeath() {
        if (!this.ctx) return;

        // Dramatic low rumble
        const osc = this.ctx.createOscillator();
        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(100, this.ctx.currentTime);
        osc.frequency.exponentialRampToValueAtTime(30, this.ctx.currentTime + 1.5);

        const filter = this.ctx.createBiquadFilter();
        filter.type = 'lowpass';
        filter.frequency.value = 300;

        const gainNode = this.ctx.createGain();
        gainNode.gain.setValueAtTime(0, this.ctx.currentTime);
        gainNode.gain.linearRampToValueAtTime(0.4, this.ctx.currentTime + 0.1);
        gainNode.gain.exponentialRampToValueAtTime(0.01, this.ctx.currentTime + 1.5);

        osc.connect(filter);
        filter.connect(gainNode);
        gainNode.connect(this.destination);

        osc.start();
        osc.stop(this.ctx.currentTime + 1.5);
    }

    playSplash() {
        if (!this.ctx) return;

        const buffer = this._createNoiseBuffer(0.4);
        const source = this.ctx.createBufferSource();
        source.buffer = buffer;

        const filter = this.ctx.createBiquadFilter();
        filter.type = 'bandpass';
        filter.frequency.setValueAtTime(1000, this.ctx.currentTime);
        filter.frequency.exponentialRampToValueAtTime(300, this.ctx.currentTime + 0.3);
        filter.Q.value = 2;

        const gainNode = this.ctx.createGain();
        gainNode.gain.setValueAtTime(0, this.ctx.currentTime);
        gainNode.gain.linearRampToValueAtTime(0.4, this.ctx.currentTime + 0.03);
        gainNode.gain.exponentialRampToValueAtTime(0.01, this.ctx.currentTime + 0.35);

        source.connect(filter);
        filter.connect(gainNode);
        gainNode.connect(this.destination);

        source.start();
        source.stop(this.ctx.currentTime + 0.4);
    }
}
