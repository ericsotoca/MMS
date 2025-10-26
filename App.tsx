
import React, { useState, useRef, useCallback, useEffect } from 'react';
import { GoogleGenAI, LiveServerMessage, Modality, Blob } from '@google/genai';
import { MicrophoneIcon } from './components/icons';

// Helper function to encode Uint8Array to base64
function encode(bytes: Uint8Array): string {
  let binary = '';
  const len = bytes.byteLength;
  for (let i = 0; i < len; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

// Helper function to create a Gemini API compatible Blob from audio data
function createBlob(data: Float32Array): Blob {
  const l = data.length;
  const int16 = new Int16Array(l);
  for (let i = 0; i < l; i++) {
    // Convert Float32 to Int16
    int16[i] = data[i] < 0 ? data[i] * 32768 : data[i] * 32767;
  }
  return {
    data: encode(new Uint8Array(int16.buffer)),
    mimeType: 'audio/pcm;rate=16000',
  };
}

// Define the LiveSession type from the Gemini SDK (not exported directly)
type LiveSession = Awaited<ReturnType<InstanceType<typeof GoogleGenAI>['live']['connect']>>;

export default function App() {
  const [isRecording, setIsRecording] = useState<boolean>(false);
  const [status, setStatus] = useState<string>('Click the microphone to start transcribing.');
  const [currentTranscription, setCurrentTranscription] = useState<string>('');
  const [transcriptionHistory, setTranscriptionHistory] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);

  const sessionPromiseRef = useRef<Promise<LiveSession> | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const scriptProcessorRef = useRef<ScriptProcessorNode | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const mediaStreamSourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  
  const currentTranscriptionRef = useRef('');
  
  useEffect(() => {
    // Cleanup function to stop recording when the component unmounts
    return () => {
      if (isRecording) {
        stopRecording();
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isRecording]);

  const stopRecording = useCallback(() => {
    setStatus('Stopping...');
    
    sessionPromiseRef.current?.then(session => session.close());
    sessionPromiseRef.current = null;

    mediaStreamRef.current?.getTracks().forEach(track => track.stop());
    mediaStreamRef.current = null;
    
    if (scriptProcessorRef.current && mediaStreamSourceRef.current) {
        mediaStreamSourceRef.current.disconnect(scriptProcessorRef.current);
        scriptProcessorRef.current.disconnect(audioContextRef.current?.destination ?? new AudioNode());
    }
    scriptProcessorRef.current = null;
    mediaStreamSourceRef.current = null;
    
    audioContextRef.current?.close().then(() => {
        audioContextRef.current = null;
    });

    setIsRecording(false);
    setStatus('Click the microphone to start transcribing.');
    if (currentTranscriptionRef.current) {
      setTranscriptionHistory(prev => [...prev, currentTranscriptionRef.current]);
    }
    setCurrentTranscription('');
    currentTranscriptionRef.current = '';
  }, []);

  const startRecording = useCallback(async () => {
    setError(null);
    setCurrentTranscription('');
    currentTranscriptionRef.current = '';
    setTranscriptionHistory([]);
    setStatus('Initializing...');

    try {
      if (!process.env.API_KEY) {
        throw new Error('API_KEY environment variable not set.');
      }
      const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });

      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      mediaStreamRef.current = stream;

      audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 16000 });
      
      sessionPromiseRef.current = ai.live.connect({
        model: 'gemini-2.5-flash-native-audio-preview-09-2025',
        callbacks: {
          onopen: () => {
            console.log('Connection opened.');
            setStatus('Listening... Speak into your microphone.');
          },
          onmessage: (message: LiveServerMessage) => {
            if (message.serverContent?.inputTranscription) {
              const text = message.serverContent.inputTranscription.text;
              currentTranscriptionRef.current += text;
              setCurrentTranscription(currentTranscriptionRef.current);
            }
            if (message.serverContent?.turnComplete) {
              if (currentTranscriptionRef.current) {
                setTranscriptionHistory(prev => [...prev, currentTranscriptionRef.current]);
                currentTranscriptionRef.current = '';
                setCurrentTranscription('');
              }
            }
          },
          onerror: (e: Error) => {
            console.error('API Error:', e);
            setError(`An API error occurred: ${e.message}. Please try again.`);
            stopRecording();
          },
          onclose: (e: CloseEvent) => {
            console.log('Connection closed.', e);
          },
        },
        config: {
          responseModalities: [Modality.AUDIO],
          inputAudioTranscription: {},
        },
      });

      mediaStreamSourceRef.current = audioContextRef.current.createMediaStreamSource(stream);
      scriptProcessorRef.current = audioContextRef.current.createScriptProcessor(4096, 1, 1);
      
      scriptProcessorRef.current.onaudioprocess = (audioProcessingEvent) => {
        const inputData = audioProcessingEvent.inputBuffer.getChannelData(0);
        const pcmBlob = createBlob(inputData);
        sessionPromiseRef.current?.then((session) => {
          session.sendRealtimeInput({ media: pcmBlob });
        });
      };

      mediaStreamSourceRef.current.connect(scriptProcessorRef.current);
      scriptProcessorRef.current.connect(audioContextRef.current.destination);

      setIsRecording(true);

    } catch (err: any) {
      console.error('Error starting recording:', err);
      setError(`Failed to start recording: ${err.message}`);
      setStatus('Click the microphone to start transcribing.');
      setIsRecording(false);
    }
  }, [stopRecording]);

  const handleToggleRecording = () => {
    if (isRecording) {
      stopRecording();
    } else {
      startRecording();
    }
  };

  return (
    <div className="min-h-screen bg-gray-900 text-gray-100 flex flex-col items-center justify-center p-4 font-sans">
      <div className="w-full max-w-3xl mx-auto flex flex-col items-center">
        <header className="text-center mb-8">
          <h1 className="text-4xl md:text-5xl font-bold text-transparent bg-clip-text bg-gradient-to-r from-blue-400 to-purple-500">
            Real-time Audio Transcriber
          </h1>
          <p className="text-lg text-gray-400 mt-2">Powered by Gemini</p>
        </header>

        <main className="w-full bg-gray-800/50 rounded-2xl shadow-2xl p-6 md:p-8 flex flex-col items-center border border-gray-700 backdrop-blur-sm">
          <div className="mb-6 text-center">
            <p className="text-gray-300 text-lg">{status}</p>
          </div>

          <button
            onClick={handleToggleRecording}
            className={`relative flex items-center justify-center w-24 h-24 rounded-full transition-all duration-300 focus:outline-none focus:ring-4 ${
              isRecording 
                ? 'bg-red-600 hover:bg-red-700 focus:ring-red-500/50' 
                : 'bg-blue-600 hover:bg-blue-700 focus:ring-blue-500/50'
            }`}
          >
            {isRecording && <span className="absolute h-full w-full rounded-full bg-red-600 animate-ping opacity-75"></span>}
            <MicrophoneIcon className="w-10 h-10 text-white" />
          </button>

          {error && <p className="mt-6 text-red-400 text-center">{error}</p>}
          
          <div className="w-full mt-8">
            <h2 className="text-xl font-semibold text-gray-300 mb-3 border-b-2 border-gray-600 pb-2">Live Transcription</h2>
            <div className="min-h-[6rem] bg-gray-900/70 p-4 rounded-lg text-gray-200 text-lg leading-relaxed shadow-inner">
              {currentTranscription || <span className="text-gray-500">...</span>}
            </div>
          </div>
          
          {transcriptionHistory.length > 0 && (
            <div className="w-full mt-8">
              <h2 className="text-xl font-semibold text-gray-300 mb-3 border-b-2 border-gray-600 pb-2">History</h2>
              <div className="space-y-4 max-h-64 overflow-y-auto pr-2">
                {transcriptionHistory.map((text, index) => (
                  <div key={index} className="bg-gray-700/50 p-4 rounded-lg">
                    <p>{text}</p>
                  </div>
                ))}
              </div>
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
