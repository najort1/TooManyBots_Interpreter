/**
 * Motor de áudio automotivo procedural para a Garagem 3D AAA.
 * Síntese em tempo real usando a Web Audio API nativa do navegador.
 * Sem dependência de arquivos de áudio externos, latência zero.
 */

class CarAudioEngine {
  private ctx: AudioContext | null = null;
  private isMuted = false;

  private init() {
    if (!this.ctx && typeof window !== "undefined") {
      const AudioCtx =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (AudioCtx) {
        this.ctx = new AudioCtx();
      }
    }
    if (this.ctx && this.ctx.state === "suspended") {
      void this.ctx.resume();
    }
  }

  toggleMute(): boolean {
    this.isMuted = !this.isMuted;
    return this.isMuted;
  }

  getMuted(): boolean {
    return this.isMuted;
  }

  // 1. Clique mecânico de catraca / chave de roda de oficina
  playMechanicalClick() {
    if (this.isMuted) return;
    this.init();
    if (!this.ctx) return;

    const t = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();

    osc.type = "square";
    osc.frequency.setValueAtTime(650, t);
    osc.frequency.exponentialRampToValueAtTime(140, t + 0.04);

    gain.gain.setValueAtTime(0.2, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.04);

    osc.connect(gain);
    gain.connect(this.ctx.destination);
    osc.start(t);
    osc.stop(t + 0.04);
  }

  // 2. Spray de tinta pressurizada de cabine de pintura
  playSprayPaint() {
    if (this.isMuted) return;
    this.init();
    if (!this.ctx) return;

    const t = this.ctx.currentTime;
    const duration = 0.22;
    const bufferSize = this.ctx.sampleRate * duration;
    const buffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i += 1) {
      data[i] = Math.random() * 2 - 1;
    }

    const noise = this.ctx.createBufferSource();
    noise.buffer = buffer;

    const filter = this.ctx.createBiquadFilter();
    filter.type = "bandpass";
    filter.frequency.setValueAtTime(1800, t);
    filter.Q.setValueAtTime(1.5, t);

    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(0.01, t);
    gain.gain.linearRampToValueAtTime(0.25, t + 0.04);
    gain.gain.exponentialRampToValueAtTime(0.001, t + duration);

    noise.connect(filter);
    filter.connect(gain);
    gain.connect(this.ctx.destination);

    noise.start(t);
  }

  // 3. Válvula pneumática / alívio de suspensão a ar ("Pssssht")
  playSuspensionAir() {
    if (this.isMuted) return;
    this.init();
    if (!this.ctx) return;

    const t = this.ctx.currentTime;
    const duration = 0.35;
    const bufferSize = this.ctx.sampleRate * duration;
    const buffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i += 1) {
      data[i] = Math.random() * 2 - 1;
    }

    const noise = this.ctx.createBufferSource();
    noise.buffer = buffer;

    const filter = this.ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.setValueAtTime(2400, t);
    filter.frequency.exponentialRampToValueAtTime(600, t + duration);

    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(0.3, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + duration);

    noise.connect(filter);
    filter.connect(gain);
    gain.connect(this.ctx.destination);
    noise.start(t);
  }

  // 4. Ativação de Neon Cyberpunk / Chime ressonante
  playNeonChime() {
    if (this.isMuted) return;
    this.init();
    if (!this.ctx) return;

    const t = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();

    osc.type = "sine";
    osc.frequency.setValueAtTime(587.33, t); // D5
    osc.frequency.exponentialRampToValueAtTime(880, t + 0.18); // A5

    gain.gain.setValueAtTime(0.18, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.28);

    osc.connect(gain);
    gain.connect(this.ctx.destination);
    osc.start(t);
    osc.stop(t + 0.28);
  }

  // 5. Partida & Ignição do Motor V8
  playEngineStart() {
    if (this.isMuted) return;
    this.init();
    if (!this.ctx) return;

    const t = this.ctx.currentTime;

    // Motor de arranque (crank-crank-crank)
    for (let i = 0; i < 3; i += 1) {
      const crankOsc = this.ctx.createOscillator();
      const crankGain = this.ctx.createGain();
      crankOsc.type = "sawtooth";
      crankOsc.frequency.setValueAtTime(45, t + i * 0.12);
      crankOsc.frequency.exponentialRampToValueAtTime(30, t + i * 0.12 + 0.08);

      crankGain.gain.setValueAtTime(0.25, t + i * 0.12);
      crankGain.gain.exponentialRampToValueAtTime(0.001, t + i * 0.12 + 0.08);

      crankOsc.connect(crankGain);
      crankGain.connect(this.ctx.destination);
      crankOsc.start(t + i * 0.12);
      crankOsc.stop(t + i * 0.12 + 0.08);
    }

    // Ignição e rugido inicial
    const startT = t + 0.38;
    const fireOsc = this.ctx.createOscillator();
    const fireGain = this.ctx.createGain();
    fireOsc.type = "sawtooth";
    fireOsc.frequency.setValueAtTime(65, startT);
    fireOsc.frequency.exponentialRampToValueAtTime(190, startT + 0.25);
    fireOsc.frequency.exponentialRampToValueAtTime(85, startT + 0.9);

    fireGain.gain.setValueAtTime(0.4, startT);
    fireGain.gain.exponentialRampToValueAtTime(0.01, startT + 0.9);

    fireOsc.connect(fireGain);
    fireGain.connect(this.ctx.destination);
    fireOsc.start(startT);
    fireOsc.stop(startT + 0.9);
  }

  // 6. Aceleração V8 Twin-Turbo + Válvula Blow-Off ("Stututu") + Pops & Bangs no corte
  playEngineRev() {
    if (this.isMuted) return;
    this.init();
    if (!this.ctx) return;

    const t = this.ctx.currentTime;

    // Oscilador 1: Frequência grave de pistões V8
    const v8Sub = this.ctx.createOscillator();
    const v8SubGain = this.ctx.createGain();
    v8Sub.type = "sawtooth";
    v8Sub.frequency.setValueAtTime(75, t);
    v8Sub.frequency.exponentialRampToValueAtTime(260, t + 0.45); // Subida de giro até 7000 RPM
    v8Sub.frequency.exponentialRampToValueAtTime(80, t + 1.2);

    v8SubGain.gain.setValueAtTime(0.35, t);
    v8SubGain.gain.linearRampToValueAtTime(0.5, t + 0.45);
    v8SubGain.gain.exponentialRampToValueAtTime(0.01, t + 1.2);

    v8Sub.connect(v8SubGain);
    v8SubGain.connect(this.ctx.destination);
    v8Sub.start(t);
    v8Sub.stop(t + 1.2);

    // Oscilador 2: Assobio de Turbina Twin-Turbo
    const turboOsc = this.ctx.createOscillator();
    const turboGain = this.ctx.createGain();
    turboOsc.type = "sine";
    turboOsc.frequency.setValueAtTime(600, t);
    turboOsc.frequency.exponentialRampToValueAtTime(2800, t + 0.45);
    turboOsc.frequency.exponentialRampToValueAtTime(400, t + 0.85);

    turboGain.gain.setValueAtTime(0.01, t);
    turboGain.gain.linearRampToValueAtTime(0.12, t + 0.4);
    turboGain.gain.exponentialRampToValueAtTime(0.001, t + 0.85);

    turboOsc.connect(turboGain);
    turboGain.connect(this.ctx.destination);
    turboOsc.start(t);
    turboOsc.stop(t + 0.85);

    // Válvula de alívio Blow-Off ("Stututu") após tirar o pé aos 0.48s
    const bovTime = t + 0.48;
    for (let flutter = 0; flutter < 4; flutter += 1) {
      const flapT = bovTime + flutter * 0.055;
      const flapOsc = this.ctx.createOscillator();
      const flapGain = this.ctx.createGain();
      flapOsc.type = "triangle";
      flapOsc.frequency.setValueAtTime(1400 - flutter * 160, flapT);
      flapOsc.frequency.exponentialRampToValueAtTime(700, flapT + 0.045);

      flapGain.gain.setValueAtTime(0.18 - flutter * 0.035, flapT);
      flapGain.gain.exponentialRampToValueAtTime(0.001, flapT + 0.045);

      flapOsc.connect(flapGain);
      flapGain.connect(this.ctx.destination);
      flapOsc.start(flapT);
      flapOsc.stop(flapT + 0.045);
    }

    // Pipocos de escapamento / Backfire ("Pops & Bangs")
    const popTimes = [t + 0.52, t + 0.65, t + 0.78];
    for (const popT of popTimes) {
      const popOsc = this.ctx.createOscillator();
      const popGain = this.ctx.createGain();
      popOsc.type = "square";
      popOsc.frequency.setValueAtTime(120, popT);
      popOsc.frequency.exponentialRampToValueAtTime(30, popT + 0.06);

      popGain.gain.setValueAtTime(0.32, popT);
      popGain.gain.exponentialRampToValueAtTime(0.001, popT + 0.06);

      popOsc.connect(popGain);
      popGain.connect(this.ctx.destination);
      popOsc.start(popT);
      popOsc.stop(popT + 0.06);
    }
  }

  // 7. Porta esportiva abrindo (travamento mecânico)
  playDoorOpen() {
    if (this.isMuted) return;
    this.init();
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = "sine";
    osc.frequency.setValueAtTime(380, t);
    osc.frequency.exponentialRampToValueAtTime(180, t + 0.08);
    gain.gain.setValueAtTime(0.2, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.08);
    osc.connect(gain);
    gain.connect(this.ctx.destination);
    osc.start(t);
    osc.stop(t + 0.08);
  }

  // 8. Porta esportiva batendo fechada (batida sólida de fibra de carbono/aço)
  playDoorClose() {
    if (this.isMuted) return;
    this.init();
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = "triangle";
    osc.frequency.setValueAtTime(160, t);
    osc.frequency.exponentialRampToValueAtTime(45, t + 0.12);
    gain.gain.setValueAtTime(0.4, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.12);
    osc.connect(gain);
    gain.connect(this.ctx.destination);
    osc.start(t);
    osc.stop(t + 0.12);
  }

  // 9. Buzina bi-tonal esportiva europeia (acorde afinado F#5 + A#5)
  playHorn() {
    if (this.isMuted) return;
    this.init();
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const duration = 0.35;

    const osc1 = this.ctx.createOscillator();
    const osc2 = this.ctx.createOscillator();
    const gain = this.ctx.createGain();

    osc1.type = "sawtooth";
    osc2.type = "sawtooth";
    osc1.frequency.setValueAtTime(370, t); // F#4
    osc2.frequency.setValueAtTime(466.16, t); // A#4

    gain.gain.setValueAtTime(0.25, t);
    gain.gain.setValueAtTime(0.25, t + duration - 0.05);
    gain.gain.exponentialRampToValueAtTime(0.001, t + duration);

    osc1.connect(gain);
    osc2.connect(gain);
    gain.connect(this.ctx.destination);

    osc1.start(t);
    osc2.start(t);
    osc1.stop(t + duration);
    osc2.stop(t + duration);
  }

  // 10. Troca de marcha sequencial ("Pneumatic Shift Clack")
  playShiftGear() {
    if (this.isMuted) return;
    this.init();
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = "square";
    osc.frequency.setValueAtTime(800, t);
    osc.frequency.exponentialRampToValueAtTime(200, t + 0.05);
    gain.gain.setValueAtTime(0.3, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.05);
    osc.connect(gain);
    gain.connect(this.ctx.destination);
    osc.start(t);
    osc.stop(t + 0.05);
  }
}

export const carAudio = new CarAudioEngine();
