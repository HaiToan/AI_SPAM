import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { 
  Mail, ShieldCheck, AlertTriangle, 
  CheckCircle, AlertCircle, PieChart as PieIcon 
} from 'lucide-react';
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip, Legend } from 'recharts';

// --- STAT CARD COMPONENT (Giữ nguyên hoặc tinh chỉnh nhẹ) ---
const StatCard = ({ title, value, icon: Icon, color, delay }) => (
  <motion.div
    initial={{ opacity: 0, y: 20 }}
    animate={{ opacity: 1, y: 0 }}
    transition={{ delay }}
    className="bg-white p-6 rounded-3xl shadow-sm border border-slate-100 flex items-center space-x-5"
  >
    <div className={`p-4 rounded-2xl ${color} shadow-lg text-white`}>
      <Icon size={28} />
    </div>
    <div>
      <p className="text-slate-500 text-sm font-medium">{title}</p>
      <h3 className="text-3xl font-black text-slate-800">{value}</h3>
    </div>
  </motion.div>
);

function App() {
  const [emails, setEmails] = useState([]);
  const [stats, setStats] = useState({ total: 0, spam: 0, ham: 0 });

  const fetchData = async () => {
    try {
      // Gọi cả 2 API cùng lúc
      const [resStats, resLogs] = await Promise.all([
        fetch('http://localhost:5000/api/stats'),
        fetch('http://localhost:5000/api/logs')
      ]);
      
      const dataStats = await resStats.json();
      const dataLogs = await resLogs.json();

      setStats(dataStats);
      setEmails(dataLogs);
    } catch (err) {
      console.error("Lỗi cập nhật dữ liệu:", err);
    }
  };

  useEffect(() => {
    fetchData(); // Chạy lần đầu
    const interval = setInterval(fetchData, 8000); // Tự động làm mới mỗi 8 giây
    return () => clearInterval(interval);
  }, []);

  const chartData = [
    { name: 'Spam', value: stats.spam },
    { name: 'Safe', value: stats.ham },
  ];
  const COLORS = ['#F43F5E', '#10B981'];

  // Tính phần trăm để hiển thị
  const spamPercent = stats.total > 0 ? ((stats.spam / stats.total) * 100).toFixed(1) : 0;

  return (
    <div className="min-h-screen bg-[#F8FAFC] p-4 md:p-8 font-sans">
      <div className="max-w-7xl mx-auto">
        
        {/* HEADER (Đã bỏ nút Refresh) */}
        <header className="mb-10 flex items-center justify-between">
          <div>
            <motion.h1 
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
              className="text-4xl font-black text-slate-900 tracking-tight"
            >
              AI Gmail <span className="text-red-600">SPAM</span>
            </motion.h1>
            <div className="flex items-center gap-2 mt-2">
              <span className="relative flex h-3 w-3">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-3 w-3 bg-emerald-500"></span>
              </span>
              <p className="text-slate-500 text-sm font-medium">Đang giám sát thời gian thực...</p>
            </div>
          </div>
        </header>

        {/* STATS GRID */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
          <StatCard title="TỔNG EMAIL QUÉT" value={stats.total} icon={Mail} color="bg-blue-600" delay={0.1} />
          <StatCard title="PHÁT HIỆN SPAM" value={stats.spam} icon={AlertTriangle} color="bg-rose-500" delay={0.2} />
          <StatCard title="THƯ AN TOÀN" value={stats.ham} icon={ShieldCheck} color="bg-emerald-500" delay={0.3} />
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8 items-start">
          
          {/* PHẦN TỶ LỆ PHÂN LOẠI (THIẾT KẾ MỚI) */}
          <motion.div 
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            className="bg-white p-8 rounded-[2rem] shadow-sm border border-slate-100 relative overflow-hidden"
          >
            <div className="flex items-center justify-between mb-8">
              <h2 className="text-xl font-bold flex items-center gap-2">
                <PieIcon className="text-blue-600" size={22} /> Tỷ lệ phân loại
              </h2>
            </div>

            <div className="relative h-64 w-full flex items-center justify-center">
              {/* Text ở giữa Donut Chart */}
              <div className="absolute text-center">
                <span className="text-4xl font-black text-slate-800">{spamPercent}%</span>
                <p className="text-xs text-slate-400 font-bold uppercase tracking-wider">Spam Rate</p>
              </div>

              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={chartData}
                    innerRadius={75}
                    outerRadius={95}
                    paddingAngle={10}
                    dataKey="value"
                    stroke="none"
                  >
                    {chartData.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={COLORS[index]} />
                    ))}
                  </Pie>
                  <Tooltip 
                    contentStyle={{ borderRadius: '16px', border: 'none', boxShadow: '0 10px 20px rgba(0,0,0,0.05)' }}
                  />
                </PieChart>
              </ResponsiveContainer>
            </div>

            {/* Chú thích chi tiết dưới biểu đồ */}
            <div className="mt-8 space-y-3">
              <div className="flex justify-between items-center p-3 bg-rose-50 rounded-2xl border border-rose-100">
                <div className="flex items-center gap-3">
                  <div className="w-2 h-2 rounded-full bg-rose-500" />
                  <span className="text-sm font-bold text-rose-700">Thư rác (Spam)</span>
                </div>
                <span className="font-black text-rose-700">{stats.spam}</span>
              </div>
              <div className="flex justify-between items-center p-3 bg-emerald-50 rounded-2xl border border-emerald-100">
                <div className="flex items-center gap-3">
                  <div className="w-2 h-2 rounded-full bg-emerald-500" />
                  <span className="text-sm font-bold text-emerald-700">An toàn (Ham)</span>
                </div>
                <span className="font-black text-emerald-700">{stats.ham}</span>
              </div>
            </div>
          </motion.div>

          {/* TABLE SECTION (GIỮ NGUYÊN HOẶC CẬP NHẬT TRỐNG) */}
          <motion.div 
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            className="lg:col-span-2 bg-white rounded-[2rem] shadow-sm border border-slate-100 overflow-hidden"
          >
            <div className="p-6 border-b border-slate-50 flex justify-between items-center bg-white/50 backdrop-blur-md sticky top-0">
              <h2 className="text-xl font-bold">Lịch sử xử lý mới nhất</h2>
              <span className="px-3 py-1 bg-blue-50 text-blue-600 text-[10px] font-black rounded-full uppercase tracking-tighter shadow-sm border border-blue-100">LIVE FEED</span>
            </div>
            
            <div className="overflow-x-auto max-h-[550px]">
              <table className="w-full text-left">
                <thead className="bg-slate-50 text-slate-400 text-[10px] uppercase font-bold tracking-widest sticky top-0">
                  <tr>
                    <th className="px-6 py-4">Nội dung tóm tắt</th>
                    <th className="px-6 py-4">Kết quả AI</th>
                    <th className="px-6 py-4 text-right">Thời gian</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-50">
                  <AnimatePresence>
                    {emails.map((email, index) => (
                      <motion.tr 
                        key={email.id}
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        className="hover:bg-slate-50/50 transition-all group"
                      >
                        <td className="px-6 py-5">
                          <p className="text-sm font-semibold text-slate-700 truncate max-w-xs group-hover:text-blue-600 transition-colors">
                            {email.email_snippet}
                          </p>
                        </td>
                        <td className="px-6 py-5">
                          {email.prediction === 'spam' ? (
                            <div className="flex items-center gap-1.5 text-rose-600 bg-rose-50 px-3 py-1 rounded-full text-[11px] font-black border border-rose-100 w-fit">
                              <AlertCircle size={14} /> SPAM
                            </div>
                          ) : (
                            <div className="flex items-center gap-1.5 text-emerald-600 bg-emerald-50 px-3 py-1 rounded-full text-[11px] font-black border border-emerald-100 w-fit">
                              <CheckCircle size={14} /> HAM
                            </div>
                          )}
                        </td>
                        <td className="px-6 py-5 text-right">
                          <span className="text-xs text-slate-400 font-bold italic">
                            {new Date(email.processed_at).toLocaleTimeString()}
                          </span>
                        </td>
                      </motion.tr>
                    ))}
                  </AnimatePresence>
                </tbody>
              </table>
            </div>
          </motion.div>
        </div>
      </div>
    </div>
  );
}

export default App;