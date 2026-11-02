import AVFoundation
import Speech

// Spracheingabe auf dem iPhone: hört zu, bis 2,5 Sekunden Ruhe ist oder „Fertig“ getippt wird
final class Speech {
    private let recognizer = SFSpeechRecognizer(locale: Locale(identifier: "de-DE"))
    private let engine = AVAudioEngine()
    private var request: SFSpeechAudioBufferRecognitionRequest?
    private var task: SFSpeechRecognitionTask?
    private var silence: Timer?
    private var text = ""
    private var onText: ((String) -> Void)?
    private var onEnd: ((String) -> Void)?
    private var running = false

    func start(onText: @escaping (String) -> Void, onEnd: @escaping (String) -> Void, ready: @escaping (Bool) -> Void) {
        SFSpeechRecognizer.requestAuthorization { status in
            AVAudioApplication.requestRecordPermission { mic in
                DispatchQueue.main.async {
                    guard status == .authorized, mic, self.recognizer?.isAvailable == true else { ready(false); return }
                    self.onText = onText
                    self.onEnd = onEnd
                    do { try self.begin(); ready(true) } catch { ready(false) }
                }
            }
        }
    }

    private func begin() throws {
        text = ""
        let session = AVAudioSession.sharedInstance()
        try session.setCategory(.record, mode: .measurement, options: .duckOthers)
        try session.setActive(true, options: .notifyOthersOnDeactivation)
        let req = SFSpeechAudioBufferRecognitionRequest()
        req.shouldReportPartialResults = true
        request = req
        let input = engine.inputNode
        input.removeTap(onBus: 0)
        input.installTap(onBus: 0, bufferSize: 1024, format: input.outputFormat(forBus: 0)) { buf, _ in req.append(buf) }
        engine.prepare()
        try engine.start()
        running = true
        task = recognizer?.recognitionTask(with: req) { [weak self] result, error in
            guard let self else { return }
            if let r = result {
                DispatchQueue.main.async {
                    self.text = r.bestTranscription.formattedString
                    self.onText?(self.text)
                    self.armSilence(2.5)
                }
                if r.isFinal { DispatchQueue.main.async { self.stop() } }
            }
            if error != nil { DispatchQueue.main.async { self.stop() } }
        }
        armSilence(8) // Zeit bis zum ersten Wort
    }

    private func armSilence(_ s: TimeInterval) {
        silence?.invalidate()
        silence = Timer.scheduledTimer(withTimeInterval: s, repeats: false) { [weak self] _ in self?.stop() }
    }

    func stop() {
        guard running else { return }
        running = false
        silence?.invalidate()
        engine.stop()
        engine.inputNode.removeTap(onBus: 0)
        request?.endAudio()
        task?.cancel()
        task = nil
        request = nil
        try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
        onEnd?(text)
        onEnd = nil
    }
}
