# Como subir o OrbitOps para a App Store (passo a passo)

## Antes de começar
Você vai precisar:
- Mac com Xcode instalado
- Conta de Desenvolvedor Apple ativa
- Terminal aberto na pasta do projeto

---

## Passo 1 — Baixar as atualizações e instalar os pacotes

Abra o Terminal, vá até a pasta do projeto e execute:

```bash
git pull
npm install
```

Isso instala o Capacitor (a ferramenta que transforma o site em app iOS).

---

## Passo 2 — Criar o projeto iOS

```bash
npx cap add ios
```

Isso cria uma pasta `ios/` com o projeto Xcode completo. Demora alguns minutos.

---

## Passo 3 — Copiar o arquivo de Privacidade

Copie o arquivo `ios-setup/PrivacyInfo.xcprivacy` para dentro do projeto iOS:

```bash
cp ios-setup/PrivacyInfo.xcprivacy ios/App/App/PrivacyInfo.xcprivacy
```

---

## Passo 4 — Abrir no Xcode

```bash
npx cap open ios
```

O Xcode vai abrir sozinho com o projeto do OrbitOps.

---

## Passo 5 — Configurar assinatura no Xcode

No Xcode:
1. Clique em **App** na barra lateral esquerda (o nome do projeto)
2. Vá na aba **Signing & Capabilities**
3. Em **Team**, selecione sua conta de desenvolvedor Apple
4. Em **Bundle Identifier**, confirme que está: `com.nicollasbeltrao.orbitops`
5. Se aparecer "Automatically manage signing" — deixe marcado

Se o Bundle ID `com.nicollasbeltrao.orbitops` não estiver registrado ainda:
- Vá em: https://developer.apple.com/account/resources/identifiers/list
- Clique em **+** → App IDs → App
- Em Bundle ID escolha **Explicit** e digite: `com.nicollasbeltrao.orbitops`
- Marque **Location** em Capabilities
- Clique em **Register**

---

## Passo 6 — Adicionar o ícone do app

No Xcode:
1. Na barra lateral, abra `App → App → Assets.xcassets → AppIcon`
2. Arraste o arquivo `public/icon-1024.png` para o espaço **App Store (1024pt)**

---

## Passo 7 — Adicionar as permissões de localização e câmera

No Xcode, abra o arquivo `Info.plist` e adicione estas duas linhas:

| Chave | Valor |
|---|---|
| NSLocationWhenInUseUsageDescription | OrbitOps uses your location to verify you are at an authorized job site when clocking in. |
| NSCameraUsageDescription | OrbitOps uses your camera to capture and upload receipts and job-site photos. |
| NSPhotoLibraryUsageDescription | OrbitOps accesses your photo library to upload receipts and job-site photos. |

Como adicionar:
1. Clique no `Info.plist`
2. Clique no **+** ao lado de qualquer linha existente
3. Digite o nome da chave e o valor em inglês exatamente como acima

---

## Passo 8 — Testar no seu iPhone (opcional mas recomendado)

1. Conecte seu iPhone ao Mac com cabo
2. No topo do Xcode, selecione seu iPhone no seletor de dispositivos
3. Clique no botão **▶ Play** (Build & Run)
4. O app vai aparecer no seu iPhone em poucos segundos

---

## Passo 9 — Criar o arquivo para a App Store (Archive)

1. No Xcode, no seletor de dispositivos no topo, escolha **Any iOS Device (arm64)**
2. Menu: **Product → Archive**
3. Aguarde o Xcode compilar (pode demorar 5–10 minutos)
4. Uma janela "Organizer" vai abrir automaticamente

---

## Passo 10 — Fazer upload para o App Store Connect

Na janela Organizer:
1. Selecione o build mais recente do OrbitOps
2. Clique em **Distribute App**
3. Escolha **App Store Connect** → **Upload**
4. Siga os passos (deixe tudo no padrão)
5. Clique em **Upload** no final

---

## Passo 11 — Configurar o app no App Store Connect

Acesse: https://appstoreconnect.apple.com

1. Vá em **My Apps**
2. Clique no **+** e crie um novo app:
   - Platform: iOS
   - Name: OrbitOps
   - Bundle ID: com.nicollasbeltrao.orbitops
   - SKU: orbitops-001
3. Preencha as informações:
   - **Description** (o que o app faz)
   - **Keywords** (palavras para busca)
   - **Support URL**: https://orbitconstructions.vercel.app/privacy
   - **Privacy Policy URL**: https://orbitconstructions.vercel.app/privacy
4. Na seção **App Review Information**, adicione uma conta de teste (admin) para os revisores da Apple testarem o app
5. Na seção **Version**, selecione o build que você acabou de fazer upload
6. Clique em **Submit for Review**

---

## Tempo esperado

- Upload + processamento: ~30 minutos
- Revisão da Apple: geralmente 1–3 dias úteis
- Se aprovado: disponível na App Store imediatamente

---

## Problemas comuns

**"No matching provisioning profile"** → Certifique-se que o Bundle ID está registrado no Apple Developer Portal e que "Automatically manage signing" está ligado no Xcode.

**"Missing purpose string"** → Você esqueceu de adicionar o NSLocationWhenInUseUsageDescription ou NSCameraUsageDescription no Info.plist.

**Rejected: "Guideline 4.2 - Minimum Functionality"** → Se a Apple rejeitar dizendo que o app é só um website, envie uma mensagem de apelação explicando: "OrbitOps is a B2B workforce management platform used by construction companies to track employee time, manage GPS-based job-site clock-ins, process expense reports, and oversee field operations. It is not a marketing website but a private business tool requiring employee credentials."
