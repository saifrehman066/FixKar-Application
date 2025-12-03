/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
*/
import { GoogleGenAI, Type } from "@google/genai";
import { render, h } from 'preact';
import { useState, useEffect, useRef, useCallback, useMemo } from 'preact/hooks';
import { html } from 'htm/preact';
import { initializeApp } from "firebase/app";
import { 
  getAuth, 
  createUserWithEmailAndPassword, 
  signInWithEmailAndPassword, 
  signOut, 
  onAuthStateChanged
  // FIX: Removed unused 'updateProfile' import which was causing an error.
} from "firebase/auth";
import { 
  getFirestore, 
  collection, 
  addDoc, 
  getDocs, 
  getDoc,
  doc, 
  setDoc, 
  updateDoc, 
  onSnapshot, 
  query, 
  orderBy, 
  arrayUnion, 
  arrayRemove,
  increment, 
  deleteDoc,
  serverTimestamp
} from "firebase/firestore";

// Declare L for leaflet to fix TypeScript errors.
declare var L: any;

const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });

// --- FIREBASE CONFIG ---
const firebaseConfig = {
  apiKey: "AIzaSyBGI2ecWaG3nTzuaqW90RgGuYYR0YB1yzQ",
  authDomain: "fix-kar-f071b.firebaseapp.com",
  projectId: "fix-kar-f071b",
  storageBucket: "fix-kar-f071b.firebasestorage.app",
  messagingSenderId: "100990222352",
  appId: "1:100990222352:web:2a393af64f29f7810f4a95"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

const statusClass = (status) => 'status-' + status.toLowerCase().replace(/ /g, '-');
const priorityClass = (priority) => 'priority-' + priority.toLowerCase();

// --- COMPONENTS ---

const AppLoader = () => html`
  <div class="app-loader">
    <svg class="login-logo loader-logo" viewBox="0 0 100 100">
      {/* Shovel - Teal */}
      <g transform="rotate(45 50 50)">
        <path d="M42,35 C35,30 35,15 50,10 C65,15 65,30 58,35 Z" fill="var(--secondary-color)"/>
        <rect x="47" y="34" width="6" height="50" rx="3" fill="var(--secondary-color)"/>
      </g>
      {/* Hammer - Orange */}
      <g transform="rotate(-45 50 50)">
        <rect x="47" y="25" width="6" height="55" rx="3" fill="var(--primary-color)"/>
        <path d="M68,12 L68,25 L47,25 L47,29 C42,32 35,30 35,22 C35,15 42,12 47,15 Z" fill="var(--primary-color)"/>
      </g>
    </svg>
    <p>Loading FixKar...</p>
  </div>
`;

const SkeletonIssueCard = () => html`
  <div class="issue-card skeleton-card">
    <div class="skeleton skeleton-image"></div>
    <div class="issue-card-content">
      <div class="issue-card-header">
        <div class="skeleton skeleton-avatar"></div>
        <div class="reporter-info" style=${{ flex: 1 }}>
          <div class="skeleton skeleton-line" style=${{ width: '60%' }}></div>
          <div class="skeleton skeleton-line" style=${{ width: '40%', marginTop: '6px' }}></div>
        </div>
      </div>
      <div class="skeleton skeleton-line" style=${{ height: '1.1rem', marginBottom: '12px', width: '80%' }}></div>
      <div class="skeleton skeleton-line" style=${{ width: '95%' }}></div>
      <div class="skeleton skeleton-line" style=${{ width: '90%' }}></div>
    </div>
    <div class="issue-card-footer">
      <div class="skeleton skeleton-line" style=${{ width: '30%', height: '24px' }}></div>
      <div class="skeleton skeleton-line" style=${{ width: '40%', height: '24px' }}></div>
    </div>
  </div>
`;

const Header = ({ user, onLogout, onNotificationsClick, onThemeToggle, theme, notificationCount }) => html`
  <header class="app-header">
    <h1 class="header-title">FixKar</h1>
    <div class="header-actions">
      <button class="notification-button" onClick=${onNotificationsClick} aria-label="Notifications">
        <span class="material-symbols-outlined">notifications</span>
        ${notificationCount > 0 && html`<span class="notification-badge">${notificationCount}</span>`}
      </button>
      <button class="theme-toggle" onClick=${onThemeToggle} aria-label="Toggle theme">
        <span class="material-symbols-outlined">${theme === 'dark' ? 'light_mode' : 'dark_mode'}</span>
      </button>
      <button class="header-button" onClick=${onLogout} aria-label="Logout">
        <span class="material-symbols-outlined">logout</span>
      </button>
    </div>
  </header>
`;

const BottomNav = ({ activeView, setActiveView, isAdmin }) => {
    const navItems = [
        { id: 'feed', icon: 'list', label: 'Feed' },
        { id: 'map', icon: 'map', label: 'Map' },
        { id: 'profile', icon: 'person', label: 'Profile' },
    ];
    if (isAdmin) {
        navItems.push({ id: 'admin', icon: 'admin_panel_settings', label: 'Admin' });
    }

    return html`
        <nav class="bottom-nav">
            ${navItems.map(item => html`
                <button 
                    class="nav-item ${activeView === item.id ? 'active' : ''}" 
                    onClick=${() => setActiveView(item.id)}
                    aria-label=${item.label}
                    aria-current=${activeView === item.id ? 'page' : false}
                >
                    <span class="material-symbols-outlined">${item.icon}</span>
                    <span class="nav-text">${item.label}</span>
                </button>
            `)}
        </nav>
    `;
};

const IssueCard = ({ issue, onVote, users, onCardClick, currentUser, onDeleteClick }) => {
    // If the user isn't found in the map (e.g., deleted user), fallback to placeholder
    const reporter = users[issue.userId] || { name: 'Unknown User', username: 'unknown', avatar: 'https://i.pravatar.cc/150' };
    const canDelete = currentUser.isAdmin || currentUser.id === issue.userId;

    const handleVoteClick = (e, vote) => {
        e.stopPropagation();
        onVote(issue.id, vote);
    }
    
    const fundProgress = issue.fundsGoal > 0 ? (issue.funds / issue.fundsGoal) * 100 : 0;
    
    // Calculate display values from Firestore data structure
    const upvoteCount = issue.upvotedBy ? issue.upvotedBy.length : 0;
    const downvoteCount = issue.downvotedBy ? issue.downvotedBy.length : 0;
    const voteScore = upvoteCount - downvoteCount;

    let userVote = null;
    if (issue.upvotedBy?.includes(currentUser.id)) userVote = 'upvote';
    if (issue.downvotedBy?.includes(currentUser.id)) userVote = 'downvote';

    return html`
        <div class="issue-card" onClick=${() => onCardClick(issue)}>
            ${canDelete && html`
              <button class="delete-issue-button" onClick=${(e) => { e.stopPropagation(); onDeleteClick(issue.id); }} aria-label="Delete issue">
                  <span class="material-symbols-outlined">delete</span>
              </button>
            `}
            <img class="issue-card-image" src=${issue.image} alt=${issue.title} />
            <div class="issue-card-content">
                <div class="issue-card-header">
                    <img class="avatar" src=${reporter.avatar} alt=${reporter.name} />
                    <div class="reporter-info">
                      <span class="reporter-name">${reporter.name}</span>
                      <span class="reporter-username">@${reporter.username}</span>
                    </div>
                </div>
                <h3>${issue.title}</h3>
                <p>${issue.description}</p>
                <div class="funding-info">
                    <div class="progress-bar">
                        <div class="progress" style=${{width: fundProgress + '%'}}></div>
                    </div>
                    <div class="funding-details">
                        <span class="funds-raised">Rs. ${issue.funds.toLocaleString()}</span>
                        <span class="funds-goal">/ ${issue.fundsGoal.toLocaleString()}</span>
                    </div>
                </div>
            </div>
            <div class="issue-card-footer">
                <div class="vote-controls">
                    <button class="upvote ${userVote === 'upvote' ? 'voted' : ''}" onClick=${e => handleVoteClick(e, 'upvote')} aria-label="Upvote">
                        <span class="material-symbols-outlined">thumb_up</span>
                    </button>
                    <span>${voteScore}</span>
                    <button class="downvote ${userVote === 'downvote' ? 'voted' : ''}" onClick=${e => handleVoteClick(e, 'downvote')} aria-label="Downvote">
                        <span class="material-symbols-outlined">thumb_down</span>
                    </button>
                </div>
                <div class="footer-actions">
                  <div class="issue-tags">
                      <span class="status-badge ${statusClass(issue.status)}">${issue.status}</span>
                      <span class="priority-badge ${priorityClass(issue.priority)}">${issue.priority}</span>
                  </div>
                </div>
            </div>
        </div>
    `;
};

const FeedView = ({ issues, onVote, users, onCardClick, currentUser, onDeleteClick, isLoading }) => {
    const [searchQuery, setSearchQuery] = useState('');
    const [sortBy, setSortBy] = useState('date');

    // Exclude pending issues from the main feed and memoize for performance
    const visibleIssues = useMemo(() => issues.filter(issue => issue.status !== 'Pending Approval'), [issues]);

    const stats = useMemo(() => ({
        total: visibleIssues.length,
        reported: visibleIssues.filter(i => i.status === 'Reported').length,
        inProgress: visibleIssues.filter(i => i.status === 'In-Progress').length,
        resolved: visibleIssues.filter(i => i.status === 'Resolved').length,
        totalFunds: visibleIssues.reduce((acc, i) => acc + (i.funds || 0), 0),
    }), [visibleIssues]);

    const filteredAndSortedIssues = useMemo(() => {
        return visibleIssues
            .filter(issue =>
                issue.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
                issue.description.toLowerCase().includes(searchQuery.toLowerCase())
            )
            .sort((a, b) => {
                const scoreA = (a.upvotedBy?.length || 0) - (a.downvotedBy?.length || 0);
                const scoreB = (b.upvotedBy?.length || 0) - (b.downvotedBy?.length || 0);
                const dateA = a.createdAt?.toMillis() || 0;
                const dateB = b.createdAt?.toMillis() || 0;

                switch (sortBy) {
                    case 'priority':
                        const priorityOrder = { 'High': 3, 'Medium': 2, 'Low': 1 };
                        return (priorityOrder[b.priority] || 0) - (priorityOrder[a.priority] || 0);
                    case 'upvotes':
                        return scoreB - scoreA;
                    case 'date':
                    default:
                        return dateB - dateA;
                }
            });
    }, [visibleIssues, searchQuery, sortBy]);

    return html`
      <div class="feed-view">
        <div class="dashboard">
             <div class="stat-card">
                <h4>Total Funds Raised</h4>
                <p>Rs. ${stats.totalFunds.toLocaleString()}</p>
                <span class="material-symbols-outlined">payments</span>
            </div>
            <div class="stat-card">
                <h4>Total Issues</h4>
                <p>${stats.total}</p>
                <span class="material-symbols-outlined">summarize</span>
            </div>
            <div class="stat-card">
                <h4>In Progress</h4>
                <p>${stats.inProgress}</p>
                <span class="material-symbols-outlined">construction</span>
            </div>
            <div class="stat-card">
                <h4>Resolved</h4>
                <p>${stats.resolved}</p>
                <span class="material-symbols-outlined">task_alt</span>
            </div>
        </div>
        
        <div class="feed-controls">
            <div class="search-bar">
                <span class="material-symbols-outlined">search</span>
                <input type="text" placeholder="Search issues..." value=${searchQuery} onInput=${e => setSearchQuery(e.target.value)} />
            </div>
        </div>

        <div class="feed-header">
            <h3 class="feed-section-header">Community Issues</h3>
            <div class="sort-options">
                <label for="sort-by">Sort:</label>
                <select id="sort-by" value=${sortBy} onChange=${e => setSortBy(e.target.value)}>
                    <option value="date">Newest</option>
                    <option value="upvotes">Popularity</option>
                    <option value="priority">Priority</option>
                </select>
            </div>
        </div>

        ${isLoading ? html`
            <div>
                <${SkeletonIssueCard} />
                <${SkeletonIssueCard} />
                <${SkeletonIssueCard} />
            </div>
        ` : filteredAndSortedIssues.length === 0 ? html`
            <div class="empty-state">
                <span class="material-symbols-outlined">search_off</span>
                <h3>No Matching Issues</h3>
                <p>Try adjusting your search or filter criteria.</p>
            </div>
        ` : filteredAndSortedIssues.map(issue => html`<${IssueCard} key=${issue.id} issue=${issue} onVote=${onVote} users=${users} onCardClick=${onCardClick} currentUser=${currentUser} onDeleteClick=${onDeleteClick} />`)}
      </div>
    `;
};

const MapView = ({ issues, theme, onMarkerClick }) => {
    const mapContainerRef = useRef(null);
    const mapRef = useRef(null);
    const markersRef = useRef([]);

    const getIconForStatus = (status) => {
        switch (status) {
            case 'Reported': return 'flag';
            case 'In-Progress': return 'construction';
            case 'Resolved': return 'task_alt';
            case 'Pending Approval': return 'pending';
            case 'Duplicate': return 'content_copy';
            default: return 'build';
        }
    };

    useEffect(() => {
        if (mapContainerRef.current && !mapRef.current) {
            mapRef.current = L.map(mapContainerRef.current).setView([24.8607, 67.0011], 12);
        }
    }, []);

    useEffect(() => {
      if (mapRef.current) {
        mapRef.current.eachLayer((layer) => {
            if (layer instanceof L.TileLayer) {
                mapRef.current.removeLayer(layer);
            }
        });
        
        const tileUrl = theme === 'dark' 
          ? 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png'
          : 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png';
          
        const attribution = theme === 'dark'
          ? '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>'
          : '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';

        L.tileLayer(tileUrl, { attribution }).addTo(mapRef.current);
      }
    }, [theme]);


    useEffect(() => {
        if (mapRef.current) {
            markersRef.current.forEach(marker => marker.remove());
            markersRef.current = [];

            issues.forEach(issue => {
                const iconName = getIconForStatus(issue.status);
                const icon = L.divIcon({
                    className: 'custom-issue-marker-container',
                    html: `<div class="marker-pin ${statusClass(issue.status)}">
                               <span class="material-symbols-outlined">${iconName}</span>
                           </div>`,
                    iconSize: [40, 40],
                    iconAnchor: [20, 40],
                    popupAnchor: [0, -40]
                });

                const marker = L.marker([issue.location.lat, issue.location.lng], { icon })
                    .addTo(mapRef.current);
                
                marker.on('click', () => onMarkerClick(issue));
                
                markersRef.current.push(marker);
            });
        }
    }, [issues, onMarkerClick]);

    return html`<div class="map-view-container"><div ref=${mapContainerRef} class="map-view"></div></div>`;
};

const ProfileView = ({ user, issues, onLogout, users, onCardClick, onDeleteClick, onEditProfile }) => {
    const userIssues = issues.filter(issue => issue.userId === user.id);
    return html`
        <div class="profile-view">
            <div class="profile-header">
                <img class="profile-avatar" src=${user.avatar} alt=${user.name} />
                <div class="profile-name-header">
                    <h2 class="profile-name">${user.name}</h2>
                    <button class="edit-profile-button" onClick=${onEditProfile} aria-label="Edit profile">
                        <span class="material-symbols-outlined">edit</span>
                    </button>
                </div>
                <p class="username">@${user.username}</p>
            </div>

            <h3 class="profile-issues-header">My Reported Issues (${userIssues.length})</h3>
            
            ${userIssues.length > 0
                ? userIssues.map(issue => html`<${IssueCard} key=${issue.id} issue=${issue} onVote=${() => {}} users=${users} onCardClick=${onCardClick} currentUser=${user} onDeleteClick=${onDeleteClick} />`)
                : html`<p class="profile-no-issues">You haven't reported any issues yet.</p>`
            }
            <button class="button logout-button" style=${{width: '100%'}} onClick=${onLogout}>Logout</button>
        </div>
    `;
}

const AdminView = ({ issues, users, onCardClick, currentUser, onDeleteClick }) => {
    const pendingIssues = issues.filter(issue => issue.status === 'Pending Approval');

    return html`
      <div class="admin-view">
        <div class="admin-header">
            <span class="material-symbols-outlined">admin_panel_settings</span>
            <h2>Admin Panel</h2>
        </div>
         <h3>Issues Pending Approval (${pendingIssues.length})</h3>
        ${pendingIssues.length > 0 ? pendingIssues.map(issue => html`<${IssueCard} key=${issue.id} issue=${issue} onVote=${() => {}} users=${users} onCardClick=${onCardClick} currentUser=${currentUser} onDeleteClick=${onDeleteClick} />`) : html`
            <div class="empty-state">
                <span class="material-symbols-outlined">done_all</span>
                <h3>All Clear!</h3>
                <p>There are no issues waiting for approval.</p>
            </div>
        `}
      </div>
    `;
};

const FundraisingModal = ({ issue, onClose, onContribute }) => {
    const [amount, setAmount] = useState('');
    const [error, setError] = useState('');
    const [step, setStep] = useState(1);
    const [selectedPayment, setSelectedPayment] = useState(null);

    const handleAmountChange = (e) => {
        const value = e.target.value;
        if (/^\d*$/.test(value)) {
            setAmount(value);
            setError('');
        }
    };

    const handlePresetClick = (presetAmount) => {
        setAmount(String(presetAmount));
        setError('');
    };

    const handleNext = () => {
        const contribution = parseInt(amount, 10);
        if (isNaN(contribution) || contribution <= 0) {
            setError('Please enter a valid amount.');
            return;
        }
        setStep(2);
    };
    
    const handleConfirm = () => {
        if (!selectedPayment) {
            setError('Please select a payment method.');
            return;
        }
        onContribute(issue.id, parseInt(amount, 10));
    };

    if (!issue) return null;

    const presetAmounts = [500, 1000, 2000, 5000];
    const paymentOptions = ['JazzCash', 'EasyPaisa', 'HBL', 'Meezan Bank', 'UBL', 'MCB Bank'];

    return html`
    <div class="modal-overlay" onClick=${onClose}>
      <div class="modal-content" onClick=${e => e.stopPropagation()}>
        <h2>${step === 1 ? 'Fund this Initiative' : 'Confirm Contribution'}</h2>
        <p class="issue-detail-address" style=${{textAlign: 'center', marginBottom: '16px'}}>${issue.title}</p>

        <div class="funds-display" style=${{marginBottom: '16px'}}>
            Rs. ${issue.funds.toLocaleString()} / ${issue.fundsGoal.toLocaleString()} raised
        </div>
        
        ${step === 1 ? html`
            <div>
                <div class="form-group">
                    <label for="fund-amount">Contribution Amount (PKR)</label>
                    <input id="fund-amount" type="text" inputmode="numeric" placeholder="e.g., 1000" value=${amount} onInput=${handleAmountChange} />
                </div>
                <div class="preset-amounts">
                  ${presetAmounts.map(p => html`<button type="button" class="preset-amount-button" onClick=${() => handlePresetClick(p)}>Rs. ${p}</button>`)}
                </div>
                <div class="modal-actions">
                    <button type="button" class="button button-secondary" onClick=${onClose}>Cancel</button>
                    <button type="button" class="button button-primary" disabled=${!amount} onClick=${handleNext}>Next</button>
                </div>
            </div>
        ` : html`
            <div>
                <p class="contribution-summary">You are contributing <strong>Rs. ${parseInt(amount, 10).toLocaleString()}</strong>.</p>
                <div class="form-group">
                    <label>Select Payment Method</label>
                    <div class="payment-options">
                        ${paymentOptions.map(opt => html`
                            <button 
                                type="button" 
                                class="payment-option-button ${selectedPayment === opt ? 'selected' : ''}" 
                                onClick=${() => { setSelectedPayment(opt); setError(''); }}>
                                ${opt}
                            </button>
                        `)}
                    </div>
                </div>
                 <div class="modal-actions">
                    <button type="button" class="button button-secondary" onClick=${() => setStep(1)}>Back</button>
                    <button type="button" class="button button-primary" disabled=${!selectedPayment} onClick=${handleConfirm}>Contribute</button>
                </div>
            </div>
        `}

        ${error && html`<p class="login-error" style=${{textAlign: 'center', marginTop: '12px'}}>${error}</p>`}
        <div class="fundraising-disclaimer">
            <span class="material-symbols-outlined" style=${{fontSize: '16px', verticalAlign: 'middle'}}>info</span>
            This is a demo. No real transaction will occur.
        </div>
      </div>
    </div>
  `;
};

const NotificationPanel = ({ notifications, onClose, onClear, onNotificationClick }) => {
  return html`
    <div class="notification-panel-overlay" onClick=${onClose}></div>
    <div class="notification-panel">
      <div class="notification-header">
        <h3>Notifications</h3>
        <button class="clear-notifications-button" onClick=${onClear}>Clear All</button>
      </div>
      <div class="notification-list">
        ${notifications.length === 0 ? html`
          <p class="notification-empty">No new notifications.</p>
        ` : notifications.map(n => html`
          <div class="notification-item ${n.read ? 'read' : 'unread'}" onClick=${() => onNotificationClick(n.id)}>
            <p>${n.text}</p>
            <span class="notification-time">${n.time}</span>
          </div>
        `)}
      </div>
    </div>
  `;
};

const AuthScreen = ({ onLogin, onSignUp, error, authMode, setAuthMode }) => {
    return html`
      <div class="login-container">
        <div class="login-box">
          <svg class="login-logo" viewBox="0 0 100 100">
            {/* Shovel - Teal */}
            <g transform="rotate(45 50 50)">
              <path d="M42,35 C35,30 35,15 50,10 C65,15 65,30 58,35 Z" fill="var(--secondary-color)"/>
              <rect x="47" y="34" width="6" height="50" rx="3" fill="var(--secondary-color)"/>
            </g>
            {/* Hammer - Orange */}
            <g transform="rotate(-45 50 50)">
              <rect x="47" y="25" width="6" height="55" rx="3" fill="var(--primary-color)"/>
              <path d="M68,12 L68,25 L47,25 L47,29 C42,32 35,30 35,22 C35,15 42,12 47,15 Z" fill="var(--primary-color)"/>
            </g>
          </svg>
          <h1 class="login-title">FixKar</h1>
          <p class="login-subtitle">${authMode === 'login' ? 'Sign in to your account' : 'Create a new account'}</p>
          
          ${authMode === 'login' ? html`
            <form onSubmit=${onLogin}>
              <div class="form-group">
                  <input id="email" name="email" type="email" placeholder="Email Address" required />
              </div>
              <div class="form-group">
                  <input id="password" name="password" type="password" placeholder="Password" required />
              </div>
              ${error && html`<p class="login-error">${error}</p>`}
              <button type="submit" class="button button-primary" style=${{width: '100%'}}>Login</button>
            </form>
             <p class="auth-toggle">
                Don't have an account? <button onClick=${() => setAuthMode('signup')}>Sign Up</button>
             </p>
          ` : html`
            <form onSubmit=${onSignUp}>
              <div class="form-group">
                  <input id="name" name="name" type="text" placeholder="Full Name" required />
              </div>
              <div class="form-group">
                  <input id="username" name="username" type="text" placeholder="Username" required />
              </div>
              <div class="form-group">
                  <input id="email" name="email" type="email" placeholder="Email Address" required />
              </div>
              <div class="form-group">
                  <input id="password" name="password" type="password" placeholder="Password" required />
              </div>
              ${error && html`<p class="login-error">${error}</p>`}
              <button type="submit" class="button button-primary" style=${{width: '100%'}}>Sign Up</button>
            </form>
            <p class="auth-toggle">
               Already have an account? <button onClick=${() => setAuthMode('login')}>Login</button>
            </p>
          `}
        </div>
      </div>
    `;
};

const FAB = ({ onClick }) => html`
    <button class="fab" onClick=${onClick} aria-label="Report new issue">
        <span class="material-symbols-outlined">add</span>
    </button>
`;

const ConfirmationModal = ({ onConfirm, onCancel, text }) => html`
    <div class="modal-overlay" onClick=${onCancel}>
        <div class="modal-content" onClick=${e => e.stopPropagation()}>
            <h2>Confirm Action</h2>
            <p>${text}</p>
            <div class="modal-actions">
                <button class="button button-secondary" onClick=${onCancel}>Cancel</button>
                <button class="button button-danger-confirm" onClick=${onConfirm}>Confirm</button>
            </div>
        </div>
    </div>
`;

const DuplicateReportModal = ({ issues, currentIssueId, onClose, onConfirm }) => {
    const [searchQuery, setSearchQuery] = useState('');
    const [selectedIssueId, setSelectedIssueId] = useState(null);

    const filteredIssues = useMemo(() => {
        return issues.filter(issue => 
            issue.id !== currentIssueId &&
            issue.status !== 'Duplicate' &&
            issue.title.toLowerCase().includes(searchQuery.toLowerCase())
        );
    }, [issues, searchQuery, currentIssueId]);

    const handleConfirmClick = () => {
        if (selectedIssueId) {
            onConfirm(selectedIssueId);
        }
    };

    return html`
        <div class="modal-overlay" onClick=${onClose}>
            <div class="modal-content duplicate-report-modal" onClick=${e => e.stopPropagation()}>
                <h2>Link to an Existing Issue</h2>
                <p>Search for and select the original issue that this one is a duplicate of.</p>

                <div class="search-bar" style=${{margin: '16px 0'}}>
                    <span class="material-symbols-outlined">search</span>
                    <input type="text" placeholder="Search by title..." value=${searchQuery} onInput=${e => setSearchQuery(e.target.value)} />
                </div>

                <div class="duplicate-issue-list">
                    ${filteredIssues.length > 0 ? filteredIssues.map(issue => html`
                        <div 
                            class="duplicate-issue-item ${selectedIssueId === issue.id ? 'selected' : ''}"
                            onClick=${() => setSelectedIssueId(issue.id)}
                            role="button"
                            tabindex="0"
                        >
                            <img src=${issue.image} alt=${issue.title} />
                            <div class="item-details">
                                <h4>${issue.title}</h4>
                                <p>${issue.address}</p>
                            </div>
                        </div>
                    `) : html`<p class="empty-tab-message">No matching issues found.</p>`}
                </div>

                <div class="modal-actions">
                    <button type="button" class="button button-secondary" onClick=${onClose}>Cancel</button>
                    <button type="button" class="button button-primary" onClick=${handleConfirmClick} disabled=${!selectedIssueId}>
                        Link as Duplicate
                    </button>
                </div>
            </div>
        </div>
    `;
};

const IssueDetailModal = ({ issue, onClose, currentUser, onUpdateStatus, onFundClick, users, onAddUpdate, onAddComment, onReportDuplicate }) => {
    if (!issue) return null;
    const [status, setStatus] = useState(issue.status);
    const [activeTab, setActiveTab] = useState('updates');
    const [newUpdate, setNewUpdate] = useState('');
    const [newComment, setNewComment] = useState('');
    
    // Fallback for user details
    const reporter = users[issue.userId] || { name: 'Unknown', username: 'unknown', avatar: 'https://i.pravatar.cc/150' };

    const handleSave = () => {
        onUpdateStatus(issue.id, status);
    };

    const handlePostUpdate = () => {
        if (newUpdate.trim()) {
            onAddUpdate(issue.id, newUpdate.trim());
            setNewUpdate('');
        }
    };
    
    const handlePostComment = () => {
        if (newComment.trim()) {
            onAddComment(issue.id, newComment.trim());
            setNewComment('');
        }
    };

    const isActionable = issue.status !== 'Resolved' && issue.status !== 'Duplicate';

    return html`
        <div class="modal-overlay" onClick=${onClose}>
            <div class="modal-content issue-detail-modal" onClick=${e => e.stopPropagation()}>
                <img class="issue-detail-image" src=${issue.image} alt=${issue.title} />
                <div class="issue-detail-content">
                    <div class="issue-card-header">
                      <img class="avatar" src=${reporter.avatar} alt=${reporter.name} />
                      <div class="reporter-info">
                        <span class="reporter-name">${reporter.name}</span>
                        <span class="reporter-username">@${reporter.username}</span>
                      </div>
                    </div>
                    <h2>${issue.title}</h2>
                    <p class="issue-detail-address">${issue.address}</p>
                    <p class="issue-detail-description">${issue.description}</p>
                    
                    <div class="issue-detail-grid">
                        <div class="form-group">
                            <label>Status</label>
                            ${currentUser.isAdmin ? html`
                                <select class="status-select" value=${status} onChange=${(e) => setStatus(e.target.value)}>
                                    <option value="Pending Approval">Pending Approval</option>
                                    <option value="Reported">Reported</option>
                                    <option value="In-Progress">In-Progress</option>
                                    <option value="Resolved">Resolved</option>
                                    <option value="Duplicate">Duplicate</option>
                                </select>
                            ` : html`
                                <div class="status-display">${issue.status}</div>
                            `}
                        </div>
                         <div class="form-group">
                            <label>Priority</label>
                            <div class="priority-display ${priorityClass(issue.priority)}">${issue.priority}</div>
                        </div>
                    </div>
                     <div class="funding-info" style=${{marginTop: '20px'}}>
                        <div class="progress-bar">
                            <div class="progress" style=${{width: (issue.funds && issue.fundsGoal ? (issue.funds/issue.fundsGoal)*100 : 0) + '%'}}></div>
                        </div>
                        <div class="funding-details">
                           <span class="funds-raised">Rs. ${issue.funds.toLocaleString()}</span>
                           <span class="funds-goal">/ ${issue.fundsGoal.toLocaleString()}</span>
                        </div>
                    </div>
                </div>
                
                <div class="issue-detail-tabs">
                    <button class="tab-button ${activeTab === 'updates' ? 'active' : ''}" onClick=${() => setActiveTab('updates')}>Updates</button>
                    <button class="tab-button ${activeTab === 'comments' ? 'active' : ''}" onClick=${() => setActiveTab('comments')}>Comments</button>
                </div>

                <div class="tab-content">
                  ${activeTab === 'updates' ? html`
                      <div class="updates-section">
                          ${currentUser.isAdmin && html`
                              <div class="add-update-form">
                                  <textarea value=${newUpdate} onInput=${e => setNewUpdate(e.target.value)} placeholder="Post a new status update..."></textarea>
                                  <button class="button button-primary" onClick=${handlePostUpdate} disabled=${!newUpdate.trim()}>Post Update</button>
                              </div>
                          `}
                          <div class="update-list">
                              ${issue.updates && issue.updates.length > 0 ? issue.updates.map(update => html`
                                  <div class="update-item">
                                      <p>${update.text}</p>
                                      <span class="timestamp">${update.timestamp && update.timestamp.toDate ? update.timestamp.toDate().toLocaleString() : 'Just now'} - by ${users[update.userId]?.name || 'Admin'}</span>
                                  </div>
                              `) : html`<p class="empty-tab-message">No updates yet.</p>`}
                          </div>
                      </div>
                  ` : html`
                      <div class="comments-section">
                           <div class="add-comment-form">
                              <textarea value=${newComment} onInput=${e => setNewComment(e.target.value)} placeholder="Add a comment..."></textarea>
                              <button class="button button-primary" onClick=${handlePostComment} disabled=${!newComment.trim()}>Post Comment</button>
                          </div>
                          <div class="comment-list">
                              ${issue.comments && issue.comments.length > 0 ? issue.comments.map(comment => {
                                  const commenter = users[comment.userId] || { name: 'Unknown', username: 'unknown', avatar: 'https://i.pravatar.cc/150' };
                                  return html`
                                      <div class="comment-item">
                                          <img class="avatar" src=${commenter.avatar} alt=${commenter.name} />
                                          <div class="comment-body">
                                              <div class="comment-header">
                                                  <div class="reporter-info">
                                                    <span class="reporter-name">${commenter.name}</span>
                                                    <span class="reporter-username">@${commenter.username}</span>
                                                  </div>
                                                  <span class="timestamp">${comment.timestamp && comment.timestamp.toDate ? comment.timestamp.toDate().toLocaleString() : 'Just now'}</span>
                                              </div>
                                              <p>${comment.text}</p>
                                          </div>
                                      </div>
                                  `
                              }) : html`<p class="empty-tab-message">No comments yet. Be the first!</p>`}
                          </div>
                      </div>
                  `}
                </div>


                <div class="modal-actions">
                    <button class="button button-secondary" onClick=${onClose}>Close</button>
                    ${currentUser.isAdmin && status !== issue.status && html`
                        <button class="button button-primary" onClick=${handleSave}>Save Status</button>
                    `}
                    ${isActionable && html`<button class="button button-secondary" onClick=${() => onReportDuplicate(issue)}>Report Duplicate</button>`}
                    ${isActionable && html`<button class="button fund-button" onClick=${() => { onClose(); onFundClick(issue); }}>Fund</button>`}
                </div>
            </div>
        </div>
    `;
};


const ReportIssueModal = ({ onClose, onCreateIssue, theme }) => {
    const [title, setTitle] = useState('');
    const [description, setDescription] = useState('');
    const [priority, setPriority] = useState('Medium');
    const [fundsGoal, setFundsGoal] = useState('');
    const [image, setImage] = useState(null); // Will hold base64 string
    const [location, setLocation] = useState({ lat: 24.8607, lng: 67.0011 });
    const [address, setAddress] = useState('Karachi, Sindh, Pakistan');
    const [isGenerating, setIsGenerating] = useState(false);
    const [isGeneratingImage, setIsGeneratingImage] = useState(false);
    
    const mapElementRef = useRef(null);
    const mapRef = useRef(null);

    useEffect(() => {
        if (mapElementRef.current && !mapRef.current) {
            mapRef.current = L.map(mapElementRef.current).setView([location.lat, location.lng], 13);
            const tileUrl = theme === 'dark' 
              ? 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png'
              : 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png';
            L.tileLayer(tileUrl).addTo(mapRef.current);

            mapRef.current.on('moveend', () => {
                const center = mapRef.current.getCenter();
                setLocation({ lat: center.lat, lng: center.lng });
            });
        }
    }, [theme]);

    const handleAiDescriptionGenerate = async () => {
        if (!title) {
            alert("Please enter a title first.");
            return;
        }
        setIsGenerating(true);
        try {
            const response = await ai.models.generateContent({
                model: 'gemini-2.5-flash',
                contents: `Based on the issue title "${title}", write a brief, clear description for a civic issue report in Karachi.`,
            });
            setDescription(response.text);
        } catch (err) {
            console.error("AI generation failed:", err);
            alert("Failed to generate description. Please try again.");
        } finally {
            setIsGenerating(false);
        }
    };

    const handleAiImageGenerate = async () => {
        if (!title) {
            alert("Please enter a title first to generate an image.");
            return;
        }
        setIsGeneratingImage(true);
        try {
            const prompt = `A realistic, high-quality photograph of a civic issue in Karachi: ${title}. ${description || ''}`;
            const response = await ai.models.generateImages({
                model: 'imagen-4.0-generate-001',
                prompt: prompt,
                config: {
                  numberOfImages: 1,
                  outputMimeType: 'image/jpeg',
                },
            });
            
            const base64ImageBytes = response.generatedImages[0].image.imageBytes;
            if (base64ImageBytes) {
                const imageUrl = `data:image/jpeg;base64,${base64ImageBytes}`;
                setImage(imageUrl);
            } else {
                 throw new Error("API returned no image data.");
            }
        } catch (err) {
            console.error("AI image generation failed:", err);
            alert("Failed to generate image. Please try again or upload one manually.");
        } finally {
            setIsGeneratingImage(false);
        }
    };
    
    const handleSubmit = (e) => {
        e.preventDefault();
        onCreateIssue({ title, description, priority, image, location, address, fundsGoal: parseInt(fundsGoal, 10) || 0 });
    };

    const handleImageUpload = (e) => {
        const file = e.target.files[0];
        if (file && file.type.startsWith('image/')) {
            const reader = new FileReader();
            reader.onloadend = () => {
                // Fix: `reader.result` can be an ArrayBuffer, so we ensure it's a string before setting the state.
                if (typeof reader.result === 'string') {
                    setImage(reader.result);
                }
            };
            reader.readAsDataURL(file);
        } else {
            alert("Please select a valid image file.");
        }
    };

    return html`
    <div class="modal-overlay" onClick=${onClose}>
      <div class="modal-content" onClick=${e => e.stopPropagation()}>
        <h2>Report a New Issue</h2>
        <form onSubmit=${handleSubmit}>
            <div class="form-group">
                <label for="title">Title</label>
                <input id="title" type="text" value=${title} onInput=${(e) => setTitle(e.target.value)} placeholder="e.g., Broken streetlight" required />
            </div>
            <div class="form-group">
                <label for="description">Description</label>
                <textarea id="description" value=${description} onInput=${(e) => setDescription(e.target.value)} placeholder="Provide details about the issue" required></textarea>
                 <button type="button" class="button button-ai" onClick=${handleAiDescriptionGenerate} disabled=${isGenerating}>
                    ${isGenerating ? html`<div class="loader-small"></div>` : html`<span class="material-symbols-outlined">auto_awesome</span>`}
                    Generate with AI
                </button>
            </div>
            <div class="form-group">
                <label>Priority</label>
                <div class="priority-selector">
                    ${['Low', 'Medium', 'High'].map(p => html`
                        <button type="button" class="priority-button priority-${p.toLowerCase()} ${priority === p ? 'selected' : ''}" onClick=${() => setPriority(p)}>${p}</button>
                    `)}
                </div>
            </div>
            <div class="form-group">
                <label for="funds-goal">Fundraising Goal (PKR)</label>
                <input id="funds-goal" type="number" inputmode="numeric" min="0" value=${fundsGoal} onInput=${(e) => setFundsGoal(e.target.value)} placeholder="e.g., 50000" />
            </div>
            <div class="form-group">
                <label for="image-upload">Image (Optional)</label>
                <div class="image-buttons-container">
                    <input id="image-upload" type="file" accept="image/*" onChange=${handleImageUpload} style=${{ display: 'none' }} />
                    <button type="button" class="button button-secondary upload-button" onClick=${() => document.getElementById('image-upload').click()}>
                        <span class="material-symbols-outlined">upload_file</span>
                        Choose
                    </button>
                    <button type="button" class="button button-ai" onClick=${handleAiImageGenerate} disabled=${isGeneratingImage || !title || !!image}>
                        ${isGeneratingImage ? html`<div class="loader-small"></div>` : html`<span class="material-symbols-outlined">auto_stories</span>`}
                        Generate
                    </button>
                </div>
                ${isGeneratingImage && !image && html`
                    <div class="image-preview-loader">
                        <div class="loader-large"></div>
                        <p>Generating image...</p>
                    </div>
                `}
                ${image && html`
                    <div class="image-preview">
                        <img src=${image} alt="Preview" />
                        <button type="button" class="remove-image-button" onClick=${() => setImage(null)} aria-label="Remove image">
                            <span class="material-symbols-outlined">close</span>
                        </button>
                    </div>
                `}
            </div>
            <div class="form-group">
                <label>Location</label>
                 <div class="report-map-container">
                    <div class="leaflet-map-instance" ref=${mapElementRef}></div>
                    <span class="material-symbols-outlined map-pin">location_on</span>
                </div>
                <div class="address-display">${address}</div>
            </div>
            <div class="modal-actions">
                <button type="button" class="button button-secondary" onClick=${onClose}>Cancel</button>
                <button type="submit" class="button button-primary" disabled=${!title || !description}>Submit Report</button>
            </div>
        </form>
      </div>
    </div>
    `;
};

const EditProfileModal = ({ user, onClose, onSave }) => {
    const [avatar, setAvatar] = useState(user.avatar);
    const [newPassword, setNewPassword] = useState('');
    const [confirmPassword, setConfirmPassword] = useState('');
    const [error, setError] = useState('');

    const handleAvatarUpload = (e) => {
        const file = e.target.files[0];
        if (!file || !file.type.startsWith('image/')) {
            alert("Please select a valid image file.");
            return;
        }

        const reader = new FileReader();
        reader.onload = (event) => {
            if (event.target && typeof event.target.result === 'string') {
                const img = new Image();
                img.src = event.target.result;
                img.onload = () => {
                    const canvas = document.createElement('canvas');
                    const ctx = canvas.getContext('2d');

                    const size = 256; 
                    canvas.width = size;
                    canvas.height = size;

                    const sourceSize = Math.min(img.width, img.height);
                    const sourceX = (img.width - sourceSize) / 2;
                    const sourceY = (img.height - sourceSize) / 2;

                    ctx.drawImage(
                        img,
                        sourceX,
                        sourceY,
                        sourceSize,
                        sourceSize,
                        0,
                        0,
                        size,
                        size
                    );

                    const croppedImageDataUrl = canvas.toDataURL('image/jpeg', 0.9);
                    setAvatar(croppedImageDataUrl);
                };
            }
        };
        reader.readAsDataURL(file);
    };
    
    const handleSave = () => {
        if (newPassword && newPassword !== confirmPassword) {
            setError("New passwords do not match.");
            return;
        }
        onSave({ avatar, password: newPassword });
        onClose();
    };

    return html`
    <div class="modal-overlay" onClick=${onClose}>
        <div class="modal-content" onClick=${e => e.stopPropagation()}>
            <h2>Edit Profile</h2>
            <div class="edit-avatar-section">
                <img class="profile-avatar-preview" src=${avatar} alt="Profile preview" />
                <input id="avatar-upload" type="file" accept="image/*" onChange=${handleAvatarUpload} style=${{ display: 'none' }} />
                <button type="button" class="button button-secondary" onClick=${() => document.getElementById('avatar-upload').click()}>
                    <span class="material-symbols-outlined" style=${{verticalAlign: 'bottom', marginRight: '4px'}}>upload</span>
                    Change Picture
                </button>
            </div>
            
            <div class="form-group">
                <label for="new-password">New Password (optional)</label>
                <input id="new-password" type="password" value=${newPassword} onInput=${e => setNewPassword(e.target.value)} placeholder="Enter new password" />
            </div>
             <div class="form-group">
                <label for="confirm-password">Confirm New Password</label>
                <input id="confirm-password" type="password" value=${confirmPassword} onInput=${e => setConfirmPassword(e.target.value)} placeholder="Confirm new password" />
            </div>
            
            ${error && html`<p class="login-error" style=${{textAlign: 'center', marginBottom: '16px'}}>${error}</p>`}
            
            <div class="modal-actions">
                <button type="button" class="button button-secondary" onClick=${onClose}>Cancel</button>
                <button type="button" class="button button-primary" onClick=${handleSave}>Save Changes</button>
            </div>
        </div>
    </div>
    `;
};

// FIX: Define interfaces for User and Issue to provide strong types for state and props.
interface User {
  id: string;
  name: string;
  username: string;
  email: string;
  avatar: string;
  isAdmin: boolean;
  createdAt?: any;
}

interface Issue {
  id: string;
  userId: string;
  title: string;
  description: string;
  image: string;
  location: { lat: number, lng: number };
  address: string;
  status: 'Pending Approval' | 'Reported' | 'In-Progress' | 'Resolved' | 'Duplicate';
  priority: 'Low' | 'Medium' | 'High';
  funds: number;
  fundsGoal: number;
  createdAt: any; // firestore.Timestamp
  upvotedBy: string[];
  downvotedBy: string[];
  updates: { text: string; timestamp: any; userId: string }[];
  comments: { text: string; timestamp: any; userId: string }[];
  duplicateOf?: string;
}


const App = () => {
  const [theme, setTheme] = useState('dark');
  // FIX: Provide explicit types for user and issues state.
  const [user, setUser] = useState<User | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [isDataLoading, setIsDataLoading] = useState(true);
  const isInitialDataLoaded = useRef(false);
  const [error, setError] = useState('');
  const [issues, setIssues] = useState<Issue[]>([]);
  const [users, setUsers] = useState<{ [key: string]: User }>({});
  const [authMode, setAuthMode] = useState('login');
  const [activeView, setActiveView] = useState('feed');
  const [fundingIssue, setFundingIssue] = useState<Issue | null>(null);
  const [detailedIssue, setDetailedIssue] = useState<Issue | null>(null);
  const [issueToDelete, setIssueToDelete] = useState<string | null>(null);
  const [isReportModalOpen, setReportModalOpen] = useState(false);
  const [notifications, setNotifications] = useState([]);
  const [showNotifications, setShowNotifications] = useState(false);
  const [isEditProfileModalOpen, setEditProfileModalOpen] = useState(false);
  const [duplicateReportTarget, setDuplicateReportTarget] = useState<Issue | null>(null);

  useEffect(() => {
    document.body.setAttribute('data-theme', theme);
  }, [theme]);

  // Auth State Listener
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (currentUser) => {
        if (currentUser) {
            // Fetch user profile from Firestore
            try {
                const docRef = doc(db, "users", currentUser.uid);
                const docSnap = await getDoc(docRef);
                if (docSnap.exists()) {
                    setUser({ id: currentUser.uid, ...docSnap.data() } as User);
                } else {
                    // Handle case where auth exists but firestore doc missing
                    console.error("No user profile found");
                    setUser(null); // Force logout if profile is missing
                }
            } catch (err) {
                console.error("Error fetching user profile:", err);
                setUser(null);
            }
        } else {
            setUser(null);
        }
        setAuthLoading(false);
    });
    return () => unsubscribe();
  }, []);

  // Fetch Issues Listener
  useEffect(() => {
    if (!user) return;
    
    // Reset loading state for new user login
    if (!isInitialDataLoaded.current) {
        setIsDataLoading(true);
    }
    
    const q = query(collection(db, "issues"), orderBy("createdAt", "desc"));
    const unsubscribe = onSnapshot(q, (snapshot) => {
        const issueList = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Issue));
        setIssues(issueList);
        
        if (!isInitialDataLoaded.current) {
            setIsDataLoading(false);
            isInitialDataLoaded.current = true;
        }
        
        // Update detailed view if open
        if (detailedIssue) {
            const updated = issueList.find(i => i.id === detailedIssue.id);
            if (updated) setDetailedIssue(updated);
            else setDetailedIssue(null); // Close if deleted
        }
    });
    return () => unsubscribe();
  }, [user]);

  // Fetch Users Listener (to populate authors)
  useEffect(() => {
      if (!user) return;
      const unsubscribe = onSnapshot(collection(db, "users"), (snapshot) => {
          const usersMap: { [key: string]: User } = {};
          snapshot.forEach(doc => {
              usersMap[doc.id] = {id: doc.id, ...doc.data()} as User;
          });
          setUsers(usersMap);
      });
      return () => unsubscribe();
  }, [user]);


  const handleLogin = async (e) => {
    e.preventDefault();
    setError('');
    const email = e.target.elements.email.value;
    const password = e.target.elements.password.value;

    try {
        await signInWithEmailAndPassword(auth, email, password);
    } catch (err) {
        setError('Invalid email or password.');
        console.error(err);
    }
  };

  const handleSignUp = async (e) => {
    e.preventDefault();
    setError('');
    const name = e.target.elements.name.value;
    const username = e.target.elements.username.value;
    const email = e.target.elements.email.value;
    const password = e.target.elements.password.value;

    try {
        const userCredential = await createUserWithEmailAndPassword(auth, email, password);
        const newUser = userCredential.user;
        
        // Create user profile in Firestore
        await setDoc(doc(db, "users", newUser.uid), {
            username: username,
            name: name,
            email: email,
            avatar: `https://i.pravatar.cc/150?u=${newUser.uid}`,
            isAdmin: false, // Default to false
            createdAt: serverTimestamp()
        });

        // User state will be set by onAuthStateChanged listener
    } catch (err) {
        setError(err.message);
        console.error(err);
    }
  };

  const handleLogout = async () => {
    try {
        await signOut(auth);
        setActiveView('feed');
        setAuthMode('login');
        setIsDataLoading(true);
        isInitialDataLoaded.current = false;
    } catch (err) {
        console.error("Logout failed", err);
    }
  };

  const toggleTheme = useCallback(() => {
    setTheme(currentTheme => (currentTheme === 'dark' ? 'light' : 'dark'));
  }, []);

  const handleVote = useCallback(async (issueId, voteType) => {
    if (!user) return;
    const issueRef = doc(db, "issues", issueId);
    
    try {
        const issue = issues.find(i => i.id === issueId);
        if (!issue) return;

        // FIX: Initialize 'updates' with a proper type to allow adding properties dynamically.
        const updates: { [key: string]: any } = {};
        
        // Logic to toggle votes in arrays
        const hasUpvoted = issue.upvotedBy?.includes(user.id);
        const hasDownvoted = issue.downvotedBy?.includes(user.id);

        if (voteType === 'upvote') {
            if (hasUpvoted) {
                updates.upvotedBy = arrayRemove(user.id);
            } else {
                updates.upvotedBy = arrayUnion(user.id);
                if (hasDownvoted) updates.downvotedBy = arrayRemove(user.id);
            }
        } else if (voteType === 'downvote') {
             if (hasDownvoted) {
                updates.downvotedBy = arrayRemove(user.id);
            } else {
                updates.downvotedBy = arrayUnion(user.id);
                if (hasUpvoted) updates.upvotedBy = arrayRemove(user.id);
            }
        }
        await updateDoc(issueRef, updates);
    } catch (err) {
        console.error("Error voting:", err);
    }
  }, [user, issues]);
  
  const handleOpenFundModal = useCallback((issue: Issue) => {
    setFundingIssue(issue);
  }, []);

  const handleContribute = useCallback(async (issueId, amount) => {
    try {
        const issueRef = doc(db, "issues", issueId);
        await updateDoc(issueRef, {
            funds: increment(amount)
        });
        setFundingIssue(null);
        // Could also add a transaction record here if needed
    } catch (err) {
        console.error("Contribution failed", err);
    }
  }, []);

  const handleToggleNotifications = useCallback(() => {
    setShowNotifications(prev => !prev);
  }, []);

  const handleNotificationClick = useCallback((notificationId) => {
      // Local state only for now, would need a notifications collection in real app
      setNotifications(currentNotifications =>
          currentNotifications.map(n => n.id === notificationId ? { ...n, read: true } : n)
      );
      setShowNotifications(false);
  }, []);

  const handleCreateIssue = useCallback(async (newIssueData) => {
    if (!user) return;
    try {
        await addDoc(collection(db, "issues"), {
            ...newIssueData,
            userId: user.id,
            status: 'Pending Approval',
            funds: 0,
            upvotedBy: [],
            downvotedBy: [],
            updates: [],
            comments: [],
            createdAt: serverTimestamp(),
            // Fallback image if not provided
            image: newIssueData.image || `https://source.unsplash.com/800x600/?${newIssueData.title.split(' ').pop()}`
        });
        setReportModalOpen(false);
    } catch (err) {
        console.error("Error creating issue:", err);
    }
  }, [user]);

  const handleDeleteIssue = useCallback((issueId: string) => {
    setIssueToDelete(issueId);
  }, []);
  
  const confirmDeleteIssue = useCallback(async () => {
      if (!issueToDelete) return;
      try {
          await deleteDoc(doc(db, "issues", issueToDelete));
          setIssueToDelete(null);
          setDetailedIssue(null);
      } catch (err) {
          console.error("Error deleting issue:", err);
      }
  }, [issueToDelete]);


  const handleUpdateStatus = useCallback(async (issueId, newStatus) => {
      try {
          await updateDoc(doc(db, "issues", issueId), { status: newStatus });
      } catch (err) {
          console.error("Error updating status:", err);
      }
  }, []);
  
  const handleAddUpdate = useCallback(async (issueId, text) => {
      if (!user) return;
      try {
          const newUpdate = {
              text,
              timestamp: new Date(), // Firestore converts Date to Timestamp
              userId: user.id
          };
          await updateDoc(doc(db, "issues", issueId), {
              updates: arrayUnion(newUpdate)
          });
      } catch (err) {
          console.error("Error adding update:", err);
      }
  }, [user]);

  const handleAddComment = useCallback(async (issueId, text) => {
      if (!user) return;
      try {
          const newComment = {
              text,
              timestamp: new Date(),
              userId: user.id
          };
          await updateDoc(doc(db, "issues", issueId), {
              comments: arrayUnion(newComment)
          });
      } catch (err) {
           console.error("Error adding comment:", err);
      }
  }, [user]);

  const handleUpdateProfile = useCallback(async ({ avatar, password }) => {
    if (!user) return;

    try {
        const userRef = doc(db, "users", user.id);
        // FIX: Initialize 'updates' with a proper type to allow adding properties dynamically.
        const updates: { [key: string]: any } = {};
        if (avatar && avatar !== user.avatar) updates.avatar = avatar;
        
        if (Object.keys(updates).length > 0) {
            await updateDoc(userRef, updates);
        }

        if (password) {
            // Note: Update password requires re-authentication in real scenarios often
            // For simplicity in this demo structure, we're skipping the auth.updatePassword() call 
            // as it requires the user to have signed in recently.
             alert("Password update requires recent login. Please re-login to change password.");
        }
        setEditProfileModalOpen(false);
    } catch (err) {
        console.error("Profile update failed", err);
        alert("Failed to update profile.");
    }
}, [user]);

  const handleOpenDuplicateModal = useCallback((issue) => {
      setDuplicateReportTarget(issue);
  }, []);

  const handleConfirmDuplicate = useCallback(async (originalIssueId: string) => {
    if (!duplicateReportTarget) return;
    try {
        const issueToUpdateRef = doc(db, "issues", duplicateReportTarget.id);
        await updateDoc(issueToUpdateRef, {
            status: 'Duplicate',
            duplicateOf: originalIssueId
        });
        setDuplicateReportTarget(null);
        setDetailedIssue(null); // Close the detail modal for clarity
    } catch (err) {
        console.error("Error marking issue as duplicate:", err);
        alert("Failed to mark as duplicate. Please try again.");
    }
  }, [duplicateReportTarget]);

  if (authLoading) {
      return html`<${AppLoader} />`;
  }

  if (!user) {
    return html`
      <${AuthScreen} 
        onLogin=${handleLogin} 
        onSignUp=${handleSignUp} 
        error=${error} 
        authMode=${authMode} 
        setAuthMode=${(mode) => { setAuthMode(mode); setError(''); }} 
      />`;
  }

  const renderActiveView = () => {
      switch (activeView) {
          case 'feed':
              return html`<${FeedView} issues=${issues} onVote=${handleVote} users=${users} onCardClick=${setDetailedIssue} currentUser=${user} onDeleteClick=${handleDeleteIssue} isLoading=${isDataLoading} />`;
          case 'map':
              return html`<${MapView} issues=${issues} theme=${theme} onMarkerClick=${setDetailedIssue} />`;
          case 'profile':
              return html`<${ProfileView} user=${user} issues=${issues} onLogout=${handleLogout} users=${users} onCardClick=${setDetailedIssue} onDeleteClick=${handleDeleteIssue} onEditProfile=${() => setEditProfileModalOpen(true)} />`;
          case 'admin':
              return user.isAdmin ? html`<${AdminView} issues=${issues} users=${users} onCardClick=${setDetailedIssue} currentUser=${user} onDeleteClick=${handleDeleteIssue} />` : null;
          default:
              return html`<${FeedView} issues=${issues} onVote=${handleVote} users=${users} onCardClick=${setDetailedIssue} currentUser=${user} onDeleteClick=${handleDeleteIssue} isLoading=${isDataLoading} />`;
      }
  }
  
  const unreadNotificationCount = notifications.filter(n => !n.read).length;

  return html`
      <${Header} user=${user} onLogout=${handleLogout} onThemeToggle=${toggleTheme} theme=${theme} notificationCount=${unreadNotificationCount} onNotificationsClick=${handleToggleNotifications} />
      <div class="main-content">
          ${renderActiveView()}
      </div>
      ${activeView === 'feed' && html`<${FAB} onClick=${() => setReportModalOpen(true)} />`}
      <${BottomNav} activeView=${activeView} setActiveView=${setActiveView} isAdmin=${user.isAdmin} />

      ${fundingIssue && html`<${FundraisingModal} issue=${fundingIssue} onClose=${() => setFundingIssue(null)} onContribute=${handleContribute} />`}
      ${showNotifications && html`<${NotificationPanel} notifications=${notifications} onClose=${handleToggleNotifications} onClear=${() => setNotifications([])} onNotificationClick=${handleNotificationClick} />`}
      ${isReportModalOpen && html`<${ReportIssueModal} onClose=${() => setReportModalOpen(false)} onCreateIssue=${handleCreateIssue} theme=${theme} />`}
      ${detailedIssue && html`<${IssueDetailModal} issue=${detailedIssue} onClose=${() => setDetailedIssue(null)} currentUser=${user} onUpdateStatus=${handleUpdateStatus} onFundClick=${handleOpenFundModal} users=${users} onAddUpdate=${handleAddUpdate} onAddComment=${handleAddComment} onReportDuplicate=${handleOpenDuplicateModal} />`}
      ${issueToDelete && html`<${ConfirmationModal} onCancel=${() => setIssueToDelete(null)} onConfirm=${confirmDeleteIssue} text="Are you sure you want to delete this issue? This action cannot be undone." />`}
      ${isEditProfileModalOpen && html`<${EditProfileModal} user=${user} onClose=${() => setEditProfileModalOpen(false)} onSave=${handleUpdateProfile} />`}
      ${duplicateReportTarget && html`<${DuplicateReportModal} issues=${issues} currentIssueId=${duplicateReportTarget.id} onClose=${() => setDuplicateReportTarget(null)} onConfirm=${handleConfirmDuplicate} />`}
  `;
};

render(h(App, null), document.getElementById('root'));