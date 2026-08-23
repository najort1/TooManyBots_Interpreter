/**
 * Construtor procedural de cenas e modelos 3D do escritório do Estagiário
 * - Mesa de escritório com chanfros, tampo em madeira nobre e pés metálicos
 * - Máquina multifuncional / scanner 3D com luz laser móvel e visor LCD
 * - Carimbo de protocolo 3D com animação física de batida mecânica
 * - Documentos 3D (Pastas suspensas, Contrato carimbado, Carta com lacre, Crachá)
 * - Itens descartáveis 3D (Xícara fumegante, Lixeira com papéis, Meme/Pepe em voxel 3D)
 * - Tapete de escritório, laptop corporativo e gaveteiro
 */

import { GeometryBuilder, MeshData } from "./glGeometry";
import { Vec4 } from "./glMath";

export interface SceneMeshes {
  officeRoom: MeshData;
  workDesk: MeshData;
  scannerStation: MeshData;
  stampDevice: MeshData;
  laserBeam: MeshData;
  trashCan: MeshData;
  documentFolder: MeshData;
  contractPaper: MeshData;
  letterSealed: MeshData;
  badgeCard: MeshData;
  coffeeCup: MeshData;
  memeFrog: MeshData;
  spamFlyer: MeshData;
}

export function buildIntern3DOffice(): SceneMeshes {
  const gb = new GeometryBuilder();

  // ==========================================
  // 1. SALA DE ESCRITÓRIO CORPORATIVO (OFFICE ROOM & FLOOR)
  // ==========================================
  gb.clear();
  // Piso com carpete corporativo azul-petróleo / cinza grafite
  gb.addBox([0, -0.05, 0], [10, 0.1, 10], [0.12, 0.15, 0.19, 1.0]);
  // Tapete elegante sob a mesa
  gb.addBox([0, 0.01, 0.1], [3.2, 0.02, 2.6], [0.18, 0.22, 0.28, 1.0]);
  // Parede de fundo com iluminação e painel de madeira acústica
  gb.addBox([0, 2.0, -3.5], [10, 4.0, 0.2], [0.08, 0.10, 0.14, 1.0]);
  // Painel ripado de madeira nobre na parede
  for (let i = -6; i <= 6; i++) {
    gb.addBox([i * 0.35, 2.0, -3.35], [0.18, 2.8, 0.08], [0.35, 0.22, 0.14, 1.0]);
  }
  // Letreiro decorativo corporativo de acrílico iluminado
  gb.addBox([0, 2.8, -3.28], [2.6, 0.6, 0.04], [0.05, 0.07, 0.10, 1.0]);
  gb.addBox([0, 2.8, -3.25], [2.4, 0.4, 0.03], [0.2, 0.7, 0.9, 1.0]); // Glow banner
  const officeRoom = gb.getMeshData();

  // ==========================================
  // 2. MESA DE TRABALHO (WORK DESK & GAVETEIRO)
  // ==========================================
  gb.clear();
  // Tampo da mesa (Madeira escura premium)
  gb.addBox([0, 0.85, 0], [2.4, 0.08, 1.4], [0.26, 0.17, 0.11, 1.0]);
  // Borda metálica chanfrada da mesa
  gb.addBox([0, 0.82, 0], [2.44, 0.02, 1.44], [0.15, 0.15, 0.18, 1.0]);
  // 4 Pés metálicos industriais
  const legColor: Vec4 = [0.12, 0.13, 0.15, 1.0];
  gb.addBox([-1.05, 0.4, -0.55], [0.08, 0.8, 0.08], legColor);
  gb.addBox([1.05, 0.4, -0.55], [0.08, 0.8, 0.08], legColor);
  gb.addBox([-1.05, 0.4, 0.55], [0.08, 0.8, 0.08], legColor);
  gb.addBox([1.05, 0.4, 0.55], [0.08, 0.8, 0.08], legColor);

  // Gaveteiro sob a mesa à esquerda
  gb.addBox([-0.75, 0.42, 0.1], [0.55, 0.75, 0.9], [0.18, 0.19, 0.22, 1.0]);
  // Puxadores cromados das gavetas
  const chrome: Vec4 = [0.8, 0.82, 0.88, 1.0];
  gb.addBox([-0.75, 0.65, 0.56], [0.18, 0.03, 0.04], chrome);
  gb.addBox([-0.75, 0.45, 0.56], [0.18, 0.03, 0.04], chrome);
  gb.addBox([-0.75, 0.25, 0.56], [0.18, 0.03, 0.04], chrome);

  // Bandeja organizadora de entrada de papéis (In-tray)
  gb.addBox([0.7, 0.92, -0.3], [0.45, 0.08, 0.55], [0.2, 0.22, 0.26, 1.0]);
  // Bandeja de saída carimbada (Out-tray)
  gb.addBox([0.7, 0.92, 0.35], [0.45, 0.08, 0.55], [0.15, 0.35, 0.22, 1.0]);

  // Desk Mat central
  gb.addBox([0, 0.895, 0.05], [1.3, 0.01, 0.9], [0.08, 0.09, 0.11, 1.0]);
  const workDesk = gb.getMeshData();

  // ==========================================
  // 3. MÁQUINA MULTIFUNCIONAL / SCANNER DIGITAL
  // ==========================================
  gb.clear();
  // Corpo principal da multifuncional (Design aerodinâmico cinza/branco)
  gb.addBox([-0.65, 1.05, -0.2], [0.65, 0.28, 0.65], [0.88, 0.90, 0.94, 1.0]);
  // Base inferior da impressora
  gb.addBox([-0.65, 0.93, -0.2], [0.68, 0.08, 0.68], [0.22, 0.24, 0.28, 1.0]);
  // Vidro da mesa de digitalização / Scanner Bed
  gb.addBox([-0.65, 1.20, -0.2], [0.52, 0.02, 0.50], [0.15, 0.35, 0.45, 0.95]);
  // Moldura do scanner
  gb.addBox([-0.65, 1.195, -0.2], [0.58, 0.01, 0.56], [0.35, 0.38, 0.42, 1.0]);

  // Painel de controle LCD frontal inclinado
  gb.addBox([-0.65, 1.16, 0.14], [0.35, 0.14, 0.08], [0.12, 0.14, 0.18, 1.0]);
  // Tela LCD iluminada
  gb.addBox([-0.65, 1.17, 0.185], [0.22, 0.08, 0.01], [0.1, 0.85, 0.65, 1.0]);
  // Botões táteis com LEDs
  gb.addBox([-0.45, 1.16, 0.185], [0.04, 0.04, 0.01], [0.2, 0.9, 0.3, 1.0]); // Start (Verde)
  gb.addBox([-0.45, 1.10, 0.185], [0.04, 0.04, 0.01], [0.95, 0.2, 0.2, 1.0]); // Stop (Vermelho)

  // Tampa aberta do scanner em ângulo
  gb.addBox([-0.65, 1.45, -0.42], [0.58, 0.45, 0.04], [0.85, 0.87, 0.90, 1.0]);
  const scannerStation = gb.getMeshData();

  // ==========================================
  // 4. FEIXE LASER DO SCANNER (Luz Volumétrica)
  // ==========================================
  gb.clear();
  // Barra laser emissora de luz turquesa/verde
  gb.addBox([0, 0, 0], [0.5, 0.02, 0.04], [0.1, 1.0, 0.8, 1.0]);
  // Leque de luz laser para efeito holográfico
  gb.addBox([0, 0.06, 0], [0.48, 0.12, 0.08], [0.2, 0.9, 0.7, 0.35]);
  const laserBeam = gb.getMeshData();

  // ==========================================
  // 5. CARIMBO DE PROTOCOLO INDUSTRIAL 3D
  // ==========================================
  gb.clear();
  // Cabo ergonômico de madeira polida
  gb.addCylinder([0, 0.35, 0], 0.04, 0.06, 0.22, 16, [0.45, 0.24, 0.12, 1.0]);
  // Topo esférico/arredondado do cabo
  gb.addCylinder([0, 0.48, 0], 0.07, 0.05, 0.08, 16, [0.52, 0.28, 0.14, 1.0]);
  // Estrutura mecânica em latão dourado / cromado
  gb.addBox([0, 0.18, 0], [0.18, 0.12, 0.14], [0.85, 0.72, 0.28, 1.0]);
  // Base carimbadora metálica
  gb.addBox([0, 0.08, 0], [0.28, 0.06, 0.20], [0.25, 0.26, 0.30, 1.0]);
  // Borracha vermelha do carimbo gravada ("APROVADO / PROTOCOLADO")
  gb.addBox([0, 0.03, 0], [0.26, 0.04, 0.18], [0.85, 0.18, 0.18, 1.0]);
  const stampDevice = gb.getMeshData();

  // ==========================================
  // 6. LIXEIRA CORPORATIVA (TRASH CAN)
  // ==========================================
  gb.clear();
  // Cesto de lixo em malha de aço escovado
  gb.addCylinder([0.85, 0.35, 0.85], 0.24, 0.18, 0.7, 16, [0.25, 0.27, 0.32, 1.0], false, true);
  // Borda superior cromada da lixeira
  gb.addCylinder([0.85, 0.70, 0.85], 0.25, 0.24, 0.04, 16, [0.75, 0.78, 0.82, 1.0], true, false);
  // Bolas de papel amassado dentro da lixeira
  gb.addBox([0.83, 0.30, 0.83], [0.12, 0.12, 0.12], [0.9, 0.9, 0.9, 1.0]);
  gb.addBox([0.87, 0.38, 0.86], [0.14, 0.13, 0.14], [0.85, 0.85, 0.82, 1.0]);
  const trashCan = gb.getMeshData();

  // ==========================================
  // 7. ITENS DO JOGO (MODELOS 3D DE ALTA FIDELIDADE)
  // ==========================================

  // --- ITEM A: PASTA DE PROCESSO CORPORATIVO COM CLIPE (📄 / 📎) ---
  gb.clear();
  // Capa da pasta em couro/papelão marrom executivo
  gb.addBox([0, 0.02, 0], [0.55, 0.03, 0.42], [0.68, 0.50, 0.30, 1.0]);
  // Aba lateral com etiqueta de identificação
  gb.addBox([-0.22, 0.036, -0.22], [0.15, 0.01, 0.06], [0.95, 0.95, 0.95, 1.0]);
  // Folhas internas de papel branco
  gb.addBox([0.02, 0.04, 0], [0.48, 0.02, 0.38], [0.95, 0.96, 0.98, 1.0]);
  // Clipe metálico prateado segurando as folhas
  gb.addBox([0.18, 0.055, -0.16], [0.06, 0.015, 0.04], [0.85, 0.88, 0.95, 1.0]);
  // Selo holográfico dourado de urgente
  gb.addBox([-0.12, 0.052, 0.12], [0.08, 0.008, 0.08], [0.95, 0.75, 0.15, 1.0]);
  const documentFolder = gb.getMeshData();

  // --- ITEM B: CONTRATO OFICIAL COM CARIMBO DE PROTOCOLO (📄) ---
  gb.clear();
  // Folha de contrato A4
  gb.addBox([0, 0.01, 0], [0.44, 0.015, 0.58], [0.98, 0.98, 0.96, 1.0]);
  // Linhas de texto impressas (simuladas em cinza escuro)
  for (let row = -0.22; row <= 0.18; row += 0.05) {
    gb.addBox([0, 0.019, row], [0.36, 0.005, 0.018], [0.25, 0.28, 0.32, 1.0]);
  }
  // Grande Carimbo Vermelho de PROTOCOLADO
  gb.addBox([0.08, 0.022, 0.15], [0.18, 0.006, 0.09], [0.88, 0.15, 0.15, 1.0]);
  const contractPaper = gb.getMeshData();

  // --- ITEM C: CARTA COM LACRE DE CERA REAL (✉️) ---
  gb.clear();
  // Envelope bege/marfim
  gb.addBox([0, 0.02, 0], [0.48, 0.03, 0.32], [0.92, 0.88, 0.78, 1.0]);
  // Dobras triangulares do envelope
  gb.addBox([0, 0.036, -0.04], [0.42, 0.005, 0.18], [0.86, 0.82, 0.72, 1.0]);
  // Lacre redondo de cera vermelha imperial
  gb.addCylinder([0, 0.045, -0.02], 0.05, 0.055, 0.02, 16, [0.75, 0.12, 0.12, 1.0]);
  const letterSealed = gb.getMeshData();

  // --- ITEM D: CRACHÁ CORPORATIVO COM CORDÃO (📎 / Crachá) ---
  gb.clear();
  // Cartão plástico de acesso RFID com foto
  gb.addBox([0, 0.015, 0], [0.32, 0.02, 0.48], [0.15, 0.45, 0.85, 1.0]);
  // Área da foto do funcionário
  gb.addBox([0, 0.026, -0.1], [0.18, 0.006, 0.18], [0.95, 0.95, 0.95, 1.0]);
  // Linhas de código de barras
  gb.addBox([0, 0.026, 0.12], [0.22, 0.006, 0.06], [0.1, 0.1, 0.1, 1.0]);
  // Cordão de tecido corporativo
  gb.addBox([0, 0.018, -0.28], [0.08, 0.015, 0.16], [0.1, 0.25, 0.55, 1.0]);
  const badgeCard = gb.getMeshData();

  // --- ITEM E (DESCARTE): XÍCARA DE CAFÉ FUMEGANTE (☕) ---
  gb.clear();
  // Caneca de cerâmica brilhante
  gb.addCylinder([0, 0.14, 0], 0.11, 0.09, 0.24, 20, [0.92, 0.25, 0.25, 1.0], false, true);
  // Café líquido escuro na superfície
  gb.addCylinder([0, 0.23, 0], 0.095, 0.095, 0.02, 16, [0.25, 0.14, 0.08, 1.0]);
  // Alça ergonômica da caneca
  gb.addBox([0.14, 0.14, 0], [0.06, 0.14, 0.04], [0.92, 0.25, 0.25, 1.0]);
  // Pires de suporte
  gb.addCylinder([0, 0.015, 0], 0.18, 0.16, 0.03, 20, [0.95, 0.95, 0.95, 1.0]);
  const coffeeCup = gb.getMeshData();

  // --- ITEM F (DESCARTE): MEME DO SAPO PEPE EM 3D VOXEL (🐸) ---
  gb.clear();
  // Cabeça verde do sapo
  gb.addBox([0, 0.18, 0], [0.34, 0.24, 0.28], [0.35, 0.75, 0.25, 1.0]);
  // Grandes olhos proeminentes
  gb.addBox([-0.12, 0.32, 0.06], [0.12, 0.12, 0.12], [0.95, 0.95, 0.95, 1.0]);
  gb.addBox([0.12, 0.32, 0.06], [0.12, 0.12, 0.12], [0.95, 0.95, 0.95, 1.0]);
  // Pupilas
  gb.addBox([-0.12, 0.32, 0.125], [0.05, 0.05, 0.01], [0.1, 0.1, 0.1, 1.0]);
  gb.addBox([0.12, 0.32, 0.125], [0.05, 0.05, 0.01], [0.1, 0.1, 0.1, 1.0]);
  // Lábios clássicos do meme
  gb.addBox([0, 0.12, 0.16], [0.28, 0.08, 0.08], [0.85, 0.35, 0.30, 1.0]);
  const memeFrog = gb.getMeshData();

  // --- ITEM G (DESCARTE): PANFLETO DE SPAM / LIXO (🗑️) ---
  gb.clear();
  // Papel amassado / panfleto chamativo amarelo e magenta
  gb.addBox([0, 0.02, 0], [0.38, 0.02, 0.46], [0.98, 0.88, 0.12, 1.0]);
  gb.addBox([0, 0.032, 0], [0.30, 0.008, 0.12], [0.95, 0.15, 0.65, 1.0]);
  gb.addBox([0.08, 0.032, -0.1], [0.15, 0.008, 0.08], [0.1, 0.7, 0.2, 1.0]);
  const spamFlyer = gb.getMeshData();

  return {
    officeRoom,
    workDesk,
    scannerStation,
    stampDevice,
    laserBeam,
    trashCan,
    documentFolder,
    contractPaper,
    letterSealed,
    badgeCard,
    coffeeCup,
    memeFrog,
    spamFlyer
  };
}
