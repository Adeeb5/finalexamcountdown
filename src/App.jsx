import React, { useState, useEffect } from 'react';
import { Calendar, Clock, BookOpen, AlertCircle, CheckCircle } from 'lucide-react';

// --- Data Configuration ---
const EXAMS = [
  {
    code: 'CSC207',
    dateStr: '2026-02-05T09:00:00',
    endTimeStr: '2026-02-05T12:00:00',
    title: 'CSC207',
    color: 'bg-blue-500',
  },
  {
    code: 'ICT200',
    dateStr: '2026-02-07T14:15:00',
    endTimeStr: '2026-02-07T17:15:00',
    title: 'ICT200',
    color: 'bg-purple-500',
  },
  {
    code: 'MAT210',
    dateStr: '2026-02-11T09:00:00',
    endTimeStr: '2026-02-11T12:00:00',
    title: 'MAT210',
    color: 'bg-emerald-500',
  },
  {
    code: 'ITT320',
    dateStr: '2026-02-12T09:00:00',
    endTimeStr: '2026-02-12T12:00:00',
    title: 'ITT320',
    color: 'bg-orange-500',
  },
  {
    code: 'CSC248',
    dateStr: '2026-02-15T14:15:00',
    endTimeStr: '2026-02-15T17:15:00',
    title: 'CSC248',
    color: 'bg-pink-500',
  },
];

// --- Helper Functions ---
function calculateTimeLeft(targetDateStr) {
  const difference = +new Date(targetDateStr) - +new Date();
  
  if (difference <= 0) {
    return null;
  }

  return {
    days: Math.floor(difference / (1000 * 60 * 60 * 24)),
    hours: Math.floor((difference / (1000 * 60 * 60)) % 24),
    minutes: Math.floor((difference / 1000 / 60) % 60),
    seconds: Math.floor((difference / 1000) % 60),
  };
}

function formatDate(dateStr) {
  const options = { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' };
  return new Date(dateStr).toLocaleDateString('en-US', options).toUpperCase();
}

function formatTime(dateStr) {
  return new Date(dateStr).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
}

// --- Components ---

const CountdownDisplay = ({ timeLeft, isFinished, isRunning }) => {
  if (isFinished) {
    return (
      <div className="flex items-center gap-2 text-gray-500 font-semibold bg-gray-100 dark:bg-gray-800 px-4 py-2 rounded-lg">
        <CheckCircle size={20} />
        <span>EXAM COMPLETED</span>
      </div>
    );
  }

  if (isRunning) {
     return (
      <div className="flex items-center gap-2 text-red-600 font-bold bg-red-50 dark:bg-red-900/20 px-4 py-2 rounded-lg animate-pulse">
        <AlertCircle size={20} />
        <span>EXAM IN PROGRESS</span>
      </div>
    );
  }

  if (!timeLeft) return null;

  return (
    <div className="grid grid-cols-4 gap-2 text-center w-full max-w-sm">
      <div className="bg-gray-50 dark:bg-gray-800 rounded-lg p-2 flex flex-col shadow-sm border border-gray-100 dark:border-gray-700">
        <span className="text-xl md:text-2xl font-bold text-gray-900 dark:text-white font-mono">{timeLeft.days}</span>
        <span className="text-[10px] uppercase text-gray-500 font-medium">Days</span>
      </div>
      <div className="bg-gray-50 dark:bg-gray-800 rounded-lg p-2 flex flex-col shadow-sm border border-gray-100 dark:border-gray-700">
        <span className="text-xl md:text-2xl font-bold text-gray-900 dark:text-white font-mono">{timeLeft.hours}</span>
        <span className="text-[10px] uppercase text-gray-500 font-medium">Hrs</span>
      </div>
      <div className="bg-gray-50 dark:bg-gray-800 rounded-lg p-2 flex flex-col shadow-sm border border-gray-100 dark:border-gray-700">
        <span className="text-xl md:text-2xl font-bold text-gray-900 dark:text-white font-mono">{timeLeft.minutes}</span>
        <span className="text-[10px] uppercase text-gray-500 font-medium">Mins</span>
      </div>
      <div className="bg-gray-50 dark:bg-gray-800 rounded-lg p-2 flex flex-col shadow-sm border border-gray-100 dark:border-gray-700">
        <span className="text-xl md:text-2xl font-bold text-gray-900 dark:text-white font-mono">{timeLeft.seconds}</span>
        <span className="text-[10px] uppercase text-gray-500 font-medium">Secs</span>
      </div>
    </div>
  );
};

const ExamCard = ({ exam }) => {
  const [timeLeft, setTimeLeft] = useState(calculateTimeLeft(exam.dateStr));
  const [status, setStatus] = useState('upcoming'); // upcoming, running, finished

  useEffect(() => {
    const timer = setInterval(() => {
      const now = new Date();
      const start = new Date(exam.dateStr);
      const end = new Date(exam.endTimeStr);

      if (now > end) {
        setStatus('finished');
        setTimeLeft(null);
      } else if (now >= start && now <= end) {
        setStatus('running');
        setTimeLeft(null);
      } else {
        setStatus('upcoming');
        setTimeLeft(calculateTimeLeft(exam.dateStr));
      }
    }, 1000);

    return () => clearInterval(timer);
  }, [exam]);

  return (
    <div className="group relative bg-white dark:bg-gray-800 rounded-2xl shadow-sm hover:shadow-md transition-all duration-300 border border-gray-100 dark:border-gray-700 overflow-hidden">
      {/* Decorative top bar */}
      <div className={`h-2 w-full ${exam.color}`}></div>
      
      <div className="p-6">
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 mb-6">
          <div className="flex items-center gap-3">
            <div className={`p-3 rounded-xl bg-gray-50 dark:bg-gray-700 text-gray-900 dark:text-white`}>
              <BookOpen size={24} />
            </div>
            <div>
              <h3 className="text-2xl font-bold text-gray-900 dark:text-white tracking-tight">{exam.code}</h3>
              <span className="text-sm text-gray-500 dark:text-gray-400 font-medium">Final Exam</span>
            </div>
          </div>
          
          <div className="flex flex-col items-end gap-1">
             <div className="flex items-center gap-2 text-gray-600 dark:text-gray-300">
               <Calendar size={16} />
               <span className="font-medium">{formatDate(exam.dateStr)}</span>
             </div>
             <div className="flex items-center gap-2 text-gray-500 dark:text-gray-400 text-sm">
               <Clock size={16} />
               <span>{formatTime(exam.dateStr)} - {formatTime(exam.endTimeStr)}</span>
             </div>
          </div>
        </div>

        <div className="mt-4 pt-6 border-t border-gray-100 dark:border-gray-700">
          <div className="flex flex-col items-center justify-center">
            <div className="mb-2 text-xs font-semibold uppercase tracking-wider text-gray-400">Time Remaining</div>
            <CountdownDisplay 
              timeLeft={timeLeft} 
              isFinished={status === 'finished'} 
              isRunning={status === 'running'} 
            />
          </div>
        </div>
      </div>
    </div>
  );
};

export default function App() {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted) return null;

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900 py-12 px-4 sm:px-6 lg:px-8 font-sans">
      <div className="max-w-3xl mx-auto space-y-8">
        
        {/* Header */}
        <div className="text-center space-y-2 mb-12">
          <h1 className="text-4xl font-black text-gray-900 dark:text-white tracking-tight">
            Adeeb's Finals
          </h1>
          <p className="text-lg text-gray-500 dark:text-gray-400 max-w-lg mx-auto">
            Stay on track. Good luck with your exams!
          </p>
        </div>

        {/* List */}
        <div className="space-y-4">
          {EXAMS.map((exam) => (
            <ExamCard key={exam.code} exam={exam} />
          ))}
        </div>

        {/* Footer */}
        <div className="text-center pt-8 text-sm text-gray-400 dark:text-gray-500">
          <p>Please double-check venues with your institution.</p>
        </div>
      </div>
    </div>
  );
}
