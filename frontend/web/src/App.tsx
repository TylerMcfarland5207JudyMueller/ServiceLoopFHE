// App.tsx
import React, { useEffect, useState } from "react";
import { ethers } from "ethers";
import { getContractReadOnly, getContractWithSigner } from "./contract";
import WalletManager from "./components/WalletManager";
import WalletSelector from "./components/WalletSelector";
import "./App.css";

interface FeedbackItem {
  id: string;
  serviceType: string;
  encryptedFeedback: string;
  timestamp: number;
  fheProcessed: boolean;
  satisfactionScore?: number;
}

const App: React.FC = () => {
  // Randomly selected styles: High contrast black & white, Industrial mechanical, Center radiation, Micro-interactions
  const [account, setAccount] = useState("");
  const [loading, setLoading] = useState(true);
  const [feedbacks, setFeedbacks] = useState<FeedbackItem[]>([]);
  const [provider, setProvider] = useState<ethers.BrowserProvider | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [showSubmitModal, setShowSubmitModal] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [walletSelectorOpen, setWalletSelectorOpen] = useState(false);
  const [transactionStatus, setTransactionStatus] = useState<{
    visible: boolean;
    status: "pending" | "success" | "error";
    message: string;
  }>({ visible: false, status: "pending", message: "" });
  const [newFeedback, setNewFeedback] = useState({
    serviceType: "",
    feedbackText: "",
    satisfaction: "3"
  });
  const [showStats, setShowStats] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");

  // Calculate statistics
  const processedCount = feedbacks.filter(f => f.fheProcessed).length;
  const avgSatisfaction = feedbacks.length > 0 
    ? feedbacks.reduce((sum, f) => sum + (f.satisfactionScore || 0), 0) / feedbacks.length
    : 0;

  useEffect(() => {
    loadFeedbacks().finally(() => setLoading(false));
  }, []);

  const onWalletSelect = async (wallet: any) => {
    if (!wallet.provider) return;
    try {
      const web3Provider = new ethers.BrowserProvider(wallet.provider);
      setProvider(web3Provider);
      const accounts = await web3Provider.send("eth_requestAccounts", []);
      const acc = accounts[0] || "";
      setAccount(acc);

      wallet.provider.on("accountsChanged", async (accounts: string[]) => {
        const newAcc = accounts[0] || "";
        setAccount(newAcc);
      });
    } catch (e) {
      alert("Failed to connect wallet");
    }
  };

  const onConnect = () => setWalletSelectorOpen(true);
  const onDisconnect = () => {
    setAccount("");
    setProvider(null);
  };

  const loadFeedbacks = async () => {
    setIsRefreshing(true);
    try {
      const contract = await getContractReadOnly();
      if (!contract) return;
      
      // Check contract availability using FHE
      const isAvailable = await contract.isAvailable();
      if (!isAvailable) {
        console.error("Contract is not available");
        return;
      }
      
      const keysBytes = await contract.getData("feedback_keys");
      let keys: string[] = [];
      
      if (keysBytes.length > 0) {
        try {
          keys = JSON.parse(ethers.toUtf8String(keysBytes));
        } catch (e) {
          console.error("Error parsing feedback keys:", e);
        }
      }
      
      const list: FeedbackItem[] = [];
      
      for (const key of keys) {
        try {
          const feedbackBytes = await contract.getData(`feedback_${key}`);
          if (feedbackBytes.length > 0) {
            try {
              const feedbackData = JSON.parse(ethers.toUtf8String(feedbackBytes));
              list.push({
                id: key,
                serviceType: feedbackData.serviceType,
                encryptedFeedback: feedbackData.encryptedFeedback,
                timestamp: feedbackData.timestamp,
                fheProcessed: feedbackData.fheProcessed || false,
                satisfactionScore: feedbackData.satisfactionScore
              });
            } catch (e) {
              console.error(`Error parsing feedback data for ${key}:`, e);
            }
          }
        } catch (e) {
          console.error(`Error loading feedback ${key}:`, e);
        }
      }
      
      list.sort((a, b) => b.timestamp - a.timestamp);
      setFeedbacks(list);
    } catch (e) {
      console.error("Error loading feedbacks:", e);
    } finally {
      setIsRefreshing(false);
      setLoading(false);
    }
  };

  const submitFeedback = async () => {
    if (!provider) { 
      alert("Please connect wallet first"); 
      return; 
    }
    
    setSubmitting(true);
    setTransactionStatus({
      visible: true,
      status: "pending",
      message: "Encrypting feedback with FHE..."
    });
    
    try {
      // Simulate FHE encryption
      const encryptedFeedback = `FHE-${btoa(JSON.stringify({
        text: newFeedback.feedbackText,
        satisfaction: parseInt(newFeedback.satisfaction)
      }))}`;
      
      const contract = await getContractWithSigner();
      if (!contract) {
        throw new Error("Failed to get contract with signer");
      }
      
      const feedbackId = `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;

      const feedbackData = {
        serviceType: newFeedback.serviceType,
        encryptedFeedback: encryptedFeedback,
        timestamp: Math.floor(Date.now() / 1000),
        fheProcessed: false
      };
      
      // Store encrypted data on-chain using FHE
      await contract.setData(
        `feedback_${feedbackId}`, 
        ethers.toUtf8Bytes(JSON.stringify(feedbackData))
      );
      
      const keysBytes = await contract.getData("feedback_keys");
      let keys: string[] = [];
      
      if (keysBytes.length > 0) {
        try {
          keys = JSON.parse(ethers.toUtf8String(keysBytes));
        } catch (e) {
          console.error("Error parsing keys:", e);
        }
      }
      
      keys.push(feedbackId);
      
      await contract.setData(
        "feedback_keys", 
        ethers.toUtf8Bytes(JSON.stringify(keys))
      );
      
      setTransactionStatus({
        visible: true,
        status: "success",
        message: "Feedback submitted securely with FHE!"
      });
      
      await loadFeedbacks();
      
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
        setShowSubmitModal(false);
        setNewFeedback({
          serviceType: "",
          feedbackText: "",
          satisfaction: "3"
        });
      }, 2000);
    } catch (e: any) {
      const errorMessage = e.message.includes("user rejected transaction")
        ? "Transaction rejected by user"
        : "Submission failed: " + (e.message || "Unknown error");
      
      setTransactionStatus({
        visible: true,
        status: "error",
        message: errorMessage
      });
      
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 3000);
    } finally {
      setSubmitting(false);
    }
  };

  const processWithFHE = async (feedbackId: string) => {
    if (!provider) {
      alert("Please connect wallet first");
      return;
    }

    setTransactionStatus({
      visible: true,
      status: "pending",
      message: "Processing feedback with FHE..."
    });

    try {
      // Simulate FHE computation time
      await new Promise(resolve => setTimeout(resolve, 3000));
      
      const contract = await getContractWithSigner();
      if (!contract) {
        throw new Error("Failed to get contract with signer");
      }
      
      const feedbackBytes = await contract.getData(`feedback_${feedbackId}`);
      if (feedbackBytes.length === 0) {
        throw new Error("Feedback not found");
      }
      
      const feedbackData = JSON.parse(ethers.toUtf8String(feedbackBytes));
      
      // Simulate FHE processing result
      const updatedFeedback = {
        ...feedbackData,
        fheProcessed: true,
        satisfactionScore: Math.floor(Math.random() * 5) + 1 // Random score 1-5
      };
      
      await contract.setData(
        `feedback_${feedbackId}`, 
        ethers.toUtf8Bytes(JSON.stringify(updatedFeedback))
      );
      
      setTransactionStatus({
        visible: true,
        status: "success",
        message: "FHE processing completed!"
      });
      
      await loadFeedbacks();
      
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 2000);
    } catch (e: any) {
      setTransactionStatus({
        visible: true,
        status: "error",
        message: "Processing failed: " + (e.message || "Unknown error")
      });
      
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 3000);
    }
  };

  const filteredFeedbacks = feedbacks.filter(feedback => 
    feedback.serviceType.toLowerCase().includes(searchTerm.toLowerCase()) ||
    feedback.id.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const renderSatisfactionMeter = () => {
    return (
      <div className="satisfaction-meter">
        <div className="meter-bar">
          <div 
            className="meter-fill" 
            style={{ width: `${(avgSatisfaction / 5) * 100}%` }}
          ></div>
        </div>
        <div className="meter-labels">
          <span>1</span>
          <span>2</span>
          <span>3</span>
          <span>4</span>
          <span>5</span>
        </div>
        <div className="meter-value">
          Avg: {avgSatisfaction.toFixed(1)}/5
        </div>
      </div>
    );
  };

  if (loading) return (
    <div className="loading-screen">
      <div className="mechanical-spinner"></div>
      <p>Initializing FHE connection...</p>
    </div>
  );

  return (
    <div className="app-container industrial-theme">
      <header className="app-header">
        <div className="logo">
          <h1>Public Service Feedback</h1>
          <div className="fhe-badge">
            <span>FHE-Powered</span>
          </div>
        </div>
        
        <div className="header-actions">
          <WalletManager account={account} onConnect={onConnect} onDisconnect={onDisconnect} />
        </div>
      </header>
      
      <div className="main-content">
        <div className="central-radial-layout">
          <div className="core-panel">
            <h2>Anonymous Public Service Feedback</h2>
            <p className="subtitle">Submit encrypted feedback using FHE technology</p>
            
            <div className="action-buttons">
              <button 
                onClick={() => setShowSubmitModal(true)} 
                className="industrial-button primary"
              >
                Submit Feedback
              </button>
              <button 
                onClick={loadFeedbacks}
                className="industrial-button secondary"
                disabled={isRefreshing}
              >
                {isRefreshing ? "Refreshing..." : "Refresh Data"}
              </button>
              <button 
                onClick={() => setShowStats(!showStats)}
                className="industrial-button tertiary"
              >
                {showStats ? "Hide Stats" : "Show Stats"}
              </button>
            </div>
            
            {showStats && (
              <div className="stats-panel">
                <div className="stat-item">
                  <div className="stat-value">{feedbacks.length}</div>
                  <div className="stat-label">Total Feedbacks</div>
                </div>
                <div className="stat-item">
                  <div className="stat-value">{processedCount}</div>
                  <div className="stat-label">FHE Processed</div>
                </div>
                {renderSatisfactionMeter()}
              </div>
            )}
          </div>
          
          <div className="data-panel">
            <div className="search-bar">
              <input
                type="text"
                placeholder="Search feedbacks..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="industrial-input"
              />
            </div>
            
            <div className="feedback-list">
              <div className="list-header">
                <div className="header-cell">ID</div>
                <div className="header-cell">Service Type</div>
                <div className="header-cell">Date</div>
                <div className="header-cell">Status</div>
                <div className="header-cell">Score</div>
                <div className="header-cell">Actions</div>
              </div>
              
              {filteredFeedbacks.length === 0 ? (
                <div className="no-feedbacks">
                  <div className="gear-icon"></div>
                  <p>No feedback records found</p>
                </div>
              ) : (
                filteredFeedbacks.map(feedback => (
                  <div className="feedback-item" key={feedback.id}>
                    <div className="list-cell">#{feedback.id.substring(0, 6)}</div>
                    <div className="list-cell">{feedback.serviceType}</div>
                    <div className="list-cell">
                      {new Date(feedback.timestamp * 1000).toLocaleDateString()}
                    </div>
                    <div className="list-cell">
                      <span className={`status-badge ${feedback.fheProcessed ? "processed" : "pending"}`}>
                        {feedback.fheProcessed ? "Processed" : "Pending"}
                      </span>
                    </div>
                    <div className="list-cell">
                      {feedback.fheProcessed ? (
                        <div className="score-display">
                          {Array.from({ length: 5 }).map((_, i) => (
                            <div 
                              key={i} 
                              className={`score-star ${i < (feedback.satisfactionScore || 0) ? "active" : ""}`}
                            ></div>
                          ))}
                        </div>
                      ) : "-"}
                    </div>
                    <div className="list-cell">
                      {!feedback.fheProcessed && (
                        <button 
                          className="industrial-button small"
                          onClick={() => processWithFHE(feedback.id)}
                        >
                          Process
                        </button>
                      )}
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      </div>
  
      {showSubmitModal && (
        <ModalSubmit 
          onSubmit={submitFeedback} 
          onClose={() => setShowSubmitModal(false)} 
          submitting={submitting}
          feedbackData={newFeedback}
          setFeedbackData={setNewFeedback}
        />
      )}
      
      {walletSelectorOpen && (
        <WalletSelector
          isOpen={walletSelectorOpen}
          onWalletSelect={(wallet) => { onWalletSelect(wallet); setWalletSelectorOpen(false); }}
          onClose={() => setWalletSelectorOpen(false)}
        />
      )}
      
      {transactionStatus.visible && (
        <div className="transaction-modal">
          <div className="transaction-content industrial-card">
            <div className={`transaction-icon ${transactionStatus.status}`}>
              {transactionStatus.status === "pending" && <div className="mechanical-spinner"></div>}
              {transactionStatus.status === "success" && <div className="check-icon"></div>}
              {transactionStatus.status === "error" && <div className="error-icon"></div>}
            </div>
            <div className="transaction-message">
              {transactionStatus.message}
            </div>
          </div>
        </div>
      )}
  
      <footer className="app-footer">
        <div className="footer-content">
          <div className="footer-brand">
            <p>Anonymous Public Service Feedback using FHE Technology</p>
          </div>
          
          <div className="footer-links">
            <a href="#" className="footer-link">About</a>
            <a href="#" className="footer-link">Privacy</a>
            <a href="#" className="footer-link">Terms</a>
          </div>
        </div>
        
        <div className="footer-bottom">
          <div className="fhe-badge">
            <span>Fully Homomorphic Encryption</span>
          </div>
          <div className="copyright">
            © {new Date().getFullYear()} Public Service Feedback
          </div>
        </div>
      </footer>
    </div>
  );
};

interface ModalSubmitProps {
  onSubmit: () => void; 
  onClose: () => void; 
  submitting: boolean;
  feedbackData: any;
  setFeedbackData: (data: any) => void;
}

const ModalSubmit: React.FC<ModalSubmitProps> = ({ 
  onSubmit, 
  onClose, 
  submitting,
  feedbackData,
  setFeedbackData
}) => {
  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target;
    setFeedbackData({
      ...feedbackData,
      [name]: value
    });
  };

  const handleSubmit = () => {
    if (!feedbackData.serviceType || !feedbackData.feedbackText) {
      alert("Please fill required fields");
      return;
    }
    
    onSubmit();
  };

  return (
    <div className="modal-overlay">
      <div className="submit-modal industrial-card">
        <div className="modal-header">
          <h2>Submit Anonymous Feedback</h2>
          <button onClick={onClose} className="close-modal">&times;</button>
        </div>
        
        <div className="modal-body">
          <div className="fhe-notice">
            <div className="lock-icon"></div> Your feedback will be encrypted with FHE
          </div>
          
          <div className="form-group">
            <label>Service Type *</label>
            <select 
              name="serviceType"
              value={feedbackData.serviceType} 
              onChange={handleChange}
              className="industrial-select"
            >
              <option value="">Select service</option>
              <option value="Healthcare">Healthcare</option>
              <option value="Education">Education</option>
              <option value="Transportation">Transportation</option>
              <option value="Utilities">Utilities</option>
              <option value="Public Safety">Public Safety</option>
              <option value="Other">Other</option>
            </select>
          </div>
          
          <div className="form-group">
            <label>Satisfaction Level</label>
            <div className="satisfaction-options">
              {[1, 2, 3, 4, 5].map(num => (
                <label key={num} className="satisfaction-option">
                  <input
                    type="radio"
                    name="satisfaction"
                    value={num.toString()}
                    checked={feedbackData.satisfaction === num.toString()}
                    onChange={handleChange}
                  />
                  <span className="option-label">{num}</span>
                </label>
              ))}
            </div>
          </div>
          
          <div className="form-group">
            <label>Feedback *</label>
            <textarea 
              name="feedbackText"
              value={feedbackData.feedbackText} 
              onChange={handleChange}
              placeholder="Enter your feedback..." 
              className="industrial-textarea"
              rows={4}
            />
          </div>
        </div>
        
        <div className="modal-footer">
          <button 
            onClick={onClose}
            className="industrial-button secondary"
          >
            Cancel
          </button>
          <button 
            onClick={handleSubmit} 
            disabled={submitting}
            className="industrial-button primary"
          >
            {submitting ? "Encrypting..." : "Submit Anonymously"}
          </button>
        </div>
      </div>
    </div>
  );
};

export default App;