const express = require('express');
const mysql = require('mysql2');
const cors = require('cors');
const dotenv = require('dotenv');
const https = require('https');
const http = require('http');

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

// MySQL Connection
const db = mysql.createPool({
    host: 'localhost',
    user: 'root',
    password: 'Anu@12345',
    database: 'library_management',
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0
});

// Test database connection
db.getConnection((err, connection) => {
    if (err) {
        console.error('❌ Database connection failed:', err.message);
        return;
    }
    console.log('✅ Connected to MySQL database');
    connection.release();
});

const COMPANY_API = "https://dev-api.humhealth.com/LibraryManagementAPI";

// Helper function to make HTTP requests
function makeRequest(url, data, method = 'POST') {
    return new Promise((resolve, reject) => {
        const urlObj = new URL(url);
        const options = {
            hostname: urlObj.hostname,
            port: urlObj.port || (urlObj.protocol === 'https:' ? 443 : 80),
            path: urlObj.pathname,
            method: method,
            headers: {
                'Content-Type': 'application/json',
                'Accept': 'application/json'
            },
            timeout: 10000
        };
        
        if (method === 'POST' && data) {
            options.headers['Content-Length'] = Buffer.byteLength(JSON.stringify(data));
        }
        
        const client = urlObj.protocol === 'https:' ? https : http;
        const req = client.request(options, (res) => {
            let responseData = '';
            res.on('data', (chunk) => { responseData += chunk; });
            res.on('end', () => {
                try {
                    const parsed = JSON.parse(responseData);
                    resolve(parsed);
                } catch (e) {
                    resolve({ status: "Error", message: "Invalid JSON response", raw: responseData });
                }
            });
        });
        
        req.on('error', reject);
        req.on('timeout', () => {
            req.destroy();
            reject(new Error('Request timeout'));
        });
        
        if (method === 'POST' && data) {
            req.write(JSON.stringify(data));
        }
        req.end();
    });
}

// ============ HELPER FUNCTION FOR BOOK INSERT ============
// Helper function to insert new book
function insertNewBook(title, author, language, genre, price, statusCodeId, bookCount, res) {
    const insertSql = `INSERT INTO books (title, author, language, genre, price, status_code_id, book_count, book_register_date) 
                       VALUES (?, ?, ?, ?, ?, ?, ?, CURDATE())`;
    
    db.query(insertSql, [title, author, language, genre || null, price, statusCodeId || 'AVAI', bookCount || 1], (err, result) => {
        if (err) {
            console.error('Error inserting book:', err);
            return res.status(500).json({ 
                status: "Error", 
                message: err.message 
            });
        }
        
        console.log(`✅ New book inserted successfully - ID: ${result.insertId}`);
        res.json({ 
            status: "Success", 
            message: "New book added successfully!",
            data: { bookId: result.insertId, action: "inserted" }
        });
    });
}

// ============ UPDATED BOOKS APIs (UPSERT) ============

// Add OR Update book in LOCAL database (UPSERT)
app.post('/api/local/books/add', (req, res) => {
    const { bookId, title, author, language, genre, price, statusCodeId, bookCount } = req.body;
    
    console.log("📚 Saving book to local DB:", req.body);
    
    if (!title || !author || !language || !price) {
        return res.status(400).json({ 
            status: "Error", 
            message: "Missing required fields: title, author, language, price" 
        });
    }
    
    // If bookId is provided, try to update existing book
    if (bookId && bookId > 0) {
        // Check if book exists
        const checkSql = `SELECT book_id FROM books WHERE book_id = ? AND book_deleted_date IS NULL`;
        
        db.query(checkSql, [bookId], (checkErr, checkResult) => {
            if (checkErr) {
                console.error('Error checking book:', checkErr);
                return res.status(500).json({ 
                    status: "Error", 
                    message: checkErr.message 
                });
            }
            
            if (checkResult.length > 0) {
                // UPDATE existing book
                const updateSql = `UPDATE books 
                                   SET title = ?, 
                                       author = ?, 
                                       language = ?, 
                                       genre = ?, 
                                       price = ?, 
                                       status_code_id = ?, 
                                       book_count = ?,
                                       updated_date = CURRENT_TIMESTAMP
                                   WHERE book_id = ? AND book_deleted_date IS NULL`;
                
                db.query(updateSql, [title, author, language, genre || null, price, statusCodeId || 'AVAI', bookCount || 1, bookId], (err, result) => {
                    if (err) {
                        console.error('Error updating book:', err);
                        return res.status(500).json({ 
                            status: "Error", 
                            message: err.message 
                        });
                    }
                    
                    console.log(`✅ Book updated successfully - ID: ${bookId}`);
                    res.json({ 
                        status: "Success", 
                        message: "Book updated successfully!",
                        data: { bookId: bookId, action: "updated" }
                    });
                });
            } else {
                // Book ID provided but not found, insert as new
                insertNewBook(title, author, language, genre, price, statusCodeId, bookCount, res);
            }
        });
    } else {
        // No bookId provided, insert as new book
        insertNewBook(title, author, language, genre, price, statusCodeId, bookCount, res);
    }
});

// Get ALL books from LOCAL database
app.get('/api/local/books/list', (req, res) => {
    const sql = `SELECT 
                    book_id as bookId, 
                    title, 
                    author, 
                    language, 
                    genre, 
                    price, 
                    status_code_id as statusCodeId,
                    DATE_FORMAT(book_register_date, '%Y-%m-%d') as bookRegisterDate,
                    book_count as bookCount
                 FROM books 
                 WHERE book_deleted_date IS NULL 
                 ORDER BY book_id DESC`;
    
    db.query(sql, (err, results) => {
        if (err) {
            console.error('Error fetching books:', err);
            return res.status(500).json({ 
                status: "Error", 
                message: err.message,
                data: [] 
            });
        }
        
        console.log(`✅ Local DB: Retrieved ${results.length} books`);
        res.json({ 
            status: "Success", 
            message: "Local books fetched successfully",
            data: results
        });
    });
});

// Get SINGLE book from LOCAL database
app.get('/api/local/books/:bookId', (req, res) => {
    const { bookId } = req.params;
    
    const sql = `SELECT 
                    book_id as bookId, 
                    title, 
                    author, 
                    language, 
                    genre, 
                    price, 
                    status_code_id as statusCodeId,
                    book_register_date as bookRegisterDate,
                    book_count as bookCount
                 FROM books 
                 WHERE book_id = ? AND book_deleted_date IS NULL`;
    
    db.query(sql, [bookId], (err, results) => {
        if (err) {
            return res.status(500).json({ 
                status: "Error", 
                message: err.message 
            });
        }
        
        if (results.length === 0) {
            return res.status(404).json({ 
                status: "Error", 
                message: `Book with ID ${bookId} not found` 
            });
        }
        
        res.json({
            status: "Success",
            message: "Book retrieved successfully",
            data: results[0]
        });
    });
});

// UPDATE book in LOCAL database (standalone update endpoint)
app.put('/api/local/books/update/:bookId', (req, res) => {
    const { bookId } = req.params;
    const { title, author, language, genre, price, statusCodeId, bookCount } = req.body;
    
    console.log(`✏️ Updating book ${bookId}:`, req.body);
    
    if (!title || !author || !language || !price) {
        return res.status(400).json({ 
            status: "Error", 
            message: "Missing required fields" 
        });
    }
    
    const sql = `UPDATE books 
                 SET title = ?, author = ?, language = ?, genre = ?, price = ?, status_code_id = ?, book_count = ?, updated_date = CURRENT_TIMESTAMP
                 WHERE book_id = ? AND book_deleted_date IS NULL`;
    
    db.query(sql, [title, author, language, genre, price, statusCodeId || 'AVAI', bookCount || 1, bookId], (err, result) => {
        if (err) {
            console.error('Error updating book:', err);
            return res.status(500).json({ 
                status: "Error", 
                message: err.message 
            });
        }
        
        if (result.affectedRows === 0) {
            return res.status(404).json({ 
                status: "Error", 
                message: `Book with ID ${bookId} not found` 
            });
        }
        
        res.json({ 
            status: "Success", 
            message: "Book updated successfully!",
            data: { bookId: bookId }
        });
    });
});

// Get books from BOTH Local DB and Company API (COMBINED)
app.get('/api/books/all', async (req, res) => {
    console.log('\n📚 Fetching books from both Local DB and Company API...');
    
    let localBooks = [];
    let apiBooks = [];
    let errors = [];
    
    // Fetch from Local MySQL Database
    const localPromise = new Promise((resolve) => {
        const sql = `SELECT 
                        book_id as bookId, 
                        title, 
                        author, 
                        language, 
                        genre, 
                        price, 
                        status_code_id as statusCodeId,
                        book_register_date as bookRegisterDate,
                        book_count as bookCount,
                        'Local DB' as source
                     FROM books 
                     WHERE book_deleted_date IS NULL 
                     ORDER BY book_id DESC`;
        
        db.query(sql, (err, results) => {
            if (err) {
                console.error('❌ Local DB error:', err);
                errors.push(`Local DB error: ${err.message}`);
                resolve([]);
            } else {
                console.log(`✅ Retrieved ${results.length} books from Local DB`);
                resolve(results);
            }
        });
    });
    
    // Fetch from Company API
    const apiPromise = new Promise(async (resolve) => {
        try {
            const payload = {
                start: 0,
                length: 100,
                searchValue: "",
                order: { sortType: "asc", sortColumn: "title" },
                filter: { language: "", genre: "", statusCode: "" }
            };
            
            const result = await makeRequest(`${COMPANY_API}/books/list`, payload, 'POST');
            let books = [];
            
            if (result.status === "Success" && result.data) {
                books = result.data;
            } else if (result.books) {
                books = result.books;
            }
            
            books = books.map(book => ({ ...book, source: 'Company API' }));
            console.log(`✅ Retrieved ${books.length} books from Company API`);
            resolve(books);
        } catch (error) {
            console.error('❌ Company API error:', error.message);
            errors.push(`Company API error: ${error.message}`);
            resolve([]);
        }
    });
    
    [localBooks, apiBooks] = await Promise.all([localPromise, apiPromise]);
    
    // Combine books and remove duplicates (by title+author)
    const allBooks = [...apiBooks, ...localBooks];
    const uniqueBooks = [];
    const seen = new Set();
    
    for (const book of allBooks) {
        const key = `${(book.title || '').toLowerCase()}|${(book.author || '').toLowerCase()}`;
        if (!seen.has(key) && book.title && book.author) {
            seen.add(key);
            uniqueBooks.push(book);
        }
    }
    
    console.log(`📊 Combined: ${uniqueBooks.length} unique books (${apiBooks.length} from API, ${localBooks.length} from Local DB)`);
    
    res.json({
        status: "Success",
        message: `Loaded ${uniqueBooks.length} books (${apiBooks.length} from API, ${localBooks.length} from Local DB)`,
        data: uniqueBooks,
        details: {
            apiCount: apiBooks.length,
            localCount: localBooks.length,
            totalUnique: uniqueBooks.length,
            errors: errors.length > 0 ? errors : null
        }
    });
});

// ============ FAVORITES APIs ============

app.post('/api/favorites/add', (req, res) => {
    const { memberId, bookId, title, author, price } = req.body;
    
    if (!memberId || !bookId) {
        return res.status(400).json({ status: "Error", message: "Member ID and Book ID are required" });
    }
    
    const checkSql = `SELECT * FROM favorites WHERE member_id = ? AND book_id = ?`;
    db.query(checkSql, [memberId, bookId], (err, results) => {
        if (err) return res.json({ status: "Error", message: err.message });
        if (results.length > 0) return res.json({ status: "Error", message: "Book already in favorites" });
        
        const sql = `INSERT INTO favorites (member_id, book_id, title, author, price, added_date) VALUES (?, ?, ?, ?, ?, CURDATE())`;
        db.query(sql, [memberId, bookId, title, author, price], (err, result) => {
            if (err) return res.json({ status: "Error", message: err.message });
            res.json({ status: "Success", message: "Book added to favorites", data: { favoriteId: result.insertId } });
        });
    });
});

app.delete('/api/favorites/remove', (req, res) => {
    const { memberId, bookId } = req.body;
    const sql = `DELETE FROM favorites WHERE member_id = ? AND book_id = ?`;
    db.query(sql, [memberId, bookId], (err, result) => {
        if (err) return res.json({ status: "Error", message: err.message });
        res.json({ status: "Success", message: "Book removed from favorites" });
    });
});

app.get('/api/favorites/list/:memberId', (req, res) => {
    const { memberId } = req.params;
    const sql = `SELECT * FROM favorites WHERE member_id = ? ORDER BY added_date DESC`;
    db.query(sql, [memberId], (err, results) => {
        if (err) return res.json({ status: "Error", message: err.message });
        res.json({ status: "Success", message: "Favorites retrieved successfully", data: results });
    });
});

app.get('/api/favorites/check/:memberId/:bookId', (req, res) => {
    const { memberId, bookId } = req.params;
    const sql = `SELECT * FROM favorites WHERE member_id = ? AND book_id = ?`;
    db.query(sql, [memberId, bookId], (err, results) => {
        if (err) return res.json({ status: "Error", message: err.message });
        res.json({ status: "Success", isFavorite: results.length > 0, data: results.length > 0 ? results[0] : null });
    });
});

// ============ CART APIs ============

app.post('/api/cart/add', (req, res) => {
    const { memberId, bookId, title, author, price } = req.body;
    
    if (!memberId || !bookId) {
        return res.status(400).json({ status: "Error", message: "Member ID and Book ID are required" });
    }
    
    const checkSql = `SELECT * FROM cart WHERE member_id = ? AND book_id = ? AND status = 'active'`;
    db.query(checkSql, [memberId, bookId], (err, results) => {
        if (err) return res.json({ status: "Error", message: err.message });
        if (results.length > 0) return res.json({ status: "Error", message: "Book already in cart" });
        
        const sql = `INSERT INTO cart (member_id, book_id, title, author, price, added_date, status) VALUES (?, ?, ?, ?, ?, CURDATE(), 'active')`;
        db.query(sql, [memberId, bookId, title, author, price], (err, result) => {
            if (err) return res.json({ status: "Error", message: err.message });
            res.json({ status: "Success", message: "Book added to cart", data: { cartId: result.insertId } });
        });
    });
});

app.delete('/api/cart/remove', (req, res) => {
    const { memberId, bookId } = req.body;
    const sql = `UPDATE cart SET status = 'removed', removed_date = CURDATE() WHERE member_id = ? AND book_id = ? AND status = 'active'`;
    db.query(sql, [memberId, bookId], (err, result) => {
        if (err) return res.json({ status: "Error", message: err.message });
        res.json({ status: "Success", message: "Book removed from cart" });
    });
});

app.get('/api/cart/list/:memberId', (req, res) => {
    const { memberId } = req.params;
    const sql = `SELECT * FROM cart WHERE member_id = ? AND status = 'active' ORDER BY added_date DESC`;
    db.query(sql, [memberId], (err, results) => {
        if (err) return res.json({ status: "Error", message: err.message });
        res.json({ status: "Success", message: "Cart retrieved successfully", data: results });
    });
});

app.get('/api/cart/check/:memberId/:bookId', (req, res) => {
    const { memberId, bookId } = req.params;
    const sql = `SELECT * FROM cart WHERE member_id = ? AND book_id = ? AND status = 'active'`;
    db.query(sql, [memberId, bookId], (err, results) => {
        if (err) return res.json({ status: "Error", message: err.message });
        res.json({ status: "Success", isInCart: results.length > 0, data: results.length > 0 ? results[0] : null });
    });
});

// ============ ENHANCED RENTAL APIs WITH PENALTY LOGIC ============

// 1. Borrow Book - Sets due date (10 days from borrow date)
app.post('/api/local/rentals/borrow', (req, res) => {
    const { memberId, bookId, bookTitle } = req.body;
    
    if (!memberId || !bookId) {
        return res.status(400).json({ 
            status: "Error", 
            message: "Member ID and Book ID are required" 
        });
    }
    
    // Calculate due date = 10 days from today
    const dueDate = new Date();
    dueDate.setDate(dueDate.getDate() + 10);
    const formattedDueDate = dueDate.toISOString().split('T')[0];
    
    const sql = `INSERT INTO rental_transactions (member_id, book_id, book_title, borrowed_date, due_date, rental_status_description) 
                 VALUES (?, ?, ?, CURDATE(), ?, 'Borrowed')`;
    
    db.query(sql, [memberId, bookId, bookTitle, formattedDueDate], (err, result) => {
        if (err) {
            console.error('Error borrowing book:', err);
            return res.json({ 
                status: "Error", 
                message: err.message 
            });
        }
        
        // Also update book status to NAVAI (Not Available)
        const updateBookSql = `UPDATE books SET status_code_id = 'NAVAI' WHERE book_id = ?`;
        db.query(updateBookSql, [bookId], (updateErr) => {
            if (updateErr) console.error('Error updating book status:', updateErr);
        });
        
        res.json({ 
            status: "Success", 
            message: `Book borrowed successfully! Due date: ${formattedDueDate}`,
            data: { 
                transactionId: result.insertId,
                dueDate: formattedDueDate,
                daysToReturn: 10
            }
        });
    });
});

// 2. Return Book - Calculate penalty if overdue
app.post('/api/local/rentals/return', async (req, res) => {
    const { transactionId } = req.body;
    
    if (!transactionId) {
        return res.status(400).json({ 
            status: "Error", 
            message: "Transaction ID is required" 
        });
    }
    
    // Get rental details
    const getRentalSql = `SELECT * FROM rental_transactions WHERE transaction_id = ?`;
    
    db.query(getRentalSql, [transactionId], async (err, rentals) => {
        if (err || rentals.length === 0) {
            return res.json({ status: "Error", message: "Rental transaction not found" });
        }
        
        const rental = rentals[0];
        const today = new Date();
        const dueDate = new Date(rental.due_date);
        const isOverdue = today > dueDate;
        let penaltyAmount = 0;
        let penaltyMessage = "";
        
        // Calculate penalty if overdue
        if (isOverdue) {
            const daysOverdue = Math.ceil((today - dueDate) / (1000 * 60 * 60 * 24));
            
            // Get book price to calculate penalty
            const getBookSql = `SELECT price, title FROM books WHERE book_id = ?`;
            const bookResult = await new Promise((resolve) => {
                db.query(getBookSql, [rental.book_id], (err, books) => {
                    resolve(books);
                });
            });
            
            const bookPrice = bookResult[0]?.price || 0;
            // Penalty = 10% of book price per day overdue (capped at 200%)
            penaltyAmount = Math.min(bookPrice * 0.1 * daysOverdue, bookPrice * 2);
            penaltyAmount = Math.round(penaltyAmount * 100) / 100;
            
            penaltyMessage = `Book is overdue by ${daysOverdue} days. Penalty amount: $${penaltyAmount.toFixed(2)}`;
            
            // Insert penalty record
            const insertPenaltySql = `INSERT INTO penalties (rental_transaction_id, amount, reason_desc, payment_status_description) 
                                      VALUES (?, ?, 'Overdue', 'Pending')`;
            db.query(insertPenaltySql, [transactionId, penaltyAmount], (penaltyErr) => {
                if (penaltyErr) console.error('Error creating penalty:', penaltyErr);
            });
        }
        
        // Update rental as returned
        const returnSql = `UPDATE rental_transactions 
                           SET actual_return_date = CURDATE(), 
                               rental_status_description = 'Returned' 
                           WHERE transaction_id = ?`;
        
        db.query(returnSql, [transactionId], (err, result) => {
            if (err) {
                return res.json({ status: "Error", message: err.message });
            }
            
            // Update book status back to AVAI (Available)
            const updateBookSql = `UPDATE books SET status_code_id = 'AVAI' WHERE book_id = ?`;
            db.query(updateBookSql, [rental.book_id], (updateErr) => {
                if (updateErr) console.error('Error updating book status:', updateErr);
            });
            
            res.json({ 
                status: "Success", 
                message: isOverdue ? `Book returned with penalty! ${penaltyMessage}` : "Book returned successfully! No penalty.",
                data: {
                    isOverdue: isOverdue,
                    penaltyAmount: penaltyAmount,
                    daysOverdue: isOverdue ? Math.ceil((today - dueDate) / (1000 * 60 * 60 * 24)) : 0
                }
            });
        });
    });
});

// 3. Get overdue rentals (for admin dashboard)
app.get('/api/local/rentals/overdue', (req, res) => {
    const sql = `SELECT r.*, m.memberFirstName, m.memberLastName, b.price, b.title as book_title
                 FROM rental_transactions r
                 LEFT JOIN members m ON r.member_id = m.memberId
                 LEFT JOIN books b ON r.book_id = b.book_id
                 WHERE r.actual_return_date IS NULL 
                 AND r.due_date < CURDATE()
                 ORDER BY r.due_date ASC`;
    
    db.query(sql, (err, results) => {
        if (err) {
            return res.json({ status: "Error", message: err.message });
        }
        
        // Calculate penalty for each overdue book
        const overdueWithPenalty = results.map(rental => {
            const today = new Date();
            const dueDate = new Date(rental.due_date);
            const daysOverdue = Math.ceil((today - dueDate) / (1000 * 60 * 60 * 24));
            const dailyPenalty = (rental.price || 0) * 0.1;
            const totalPenalty = Math.min(dailyPenalty * daysOverdue, (rental.price || 0) * 2);
            
            return {
                ...rental,
                daysOverdue: daysOverdue,
                dailyPenalty: dailyPenalty,
                totalPenalty: Math.round(totalPenalty * 100) / 100
            };
        });
        
        res.json({ 
            status: "Success", 
            message: `Found ${overdueWithPenalty.length} overdue rentals`,
            data: overdueWithPenalty
        });
    });
});

// 4. Calculate penalty for a specific rental
app.get('/api/local/rentals/calculate-penalty/:transactionId', (req, res) => {
    const { transactionId } = req.params;
    
    const sql = `SELECT r.*, b.price, b.title 
                 FROM rental_transactions r
                 LEFT JOIN books b ON r.book_id = b.book_id
                 WHERE r.transaction_id = ?`;
    
    db.query(sql, [transactionId], (err, results) => {
        if (err || results.length === 0) {
            return res.json({ status: "Error", message: "Rental not found" });
        }
        
        const rental = results[0];
        const today = new Date();
        const dueDate = new Date(rental.due_date);
        
        if (today <= dueDate) {
            return res.json({ 
                status: "Success", 
                message: "Book is not overdue",
                data: { isOverdue: false, penaltyAmount: 0, daysOverdue: 0 }
            });
        }
        
        const daysOverdue = Math.ceil((today - dueDate) / (1000 * 60 * 60 * 24));
        const dailyPenalty = (rental.price || 0) * 0.1; // 10% of book price per day
        const totalPenalty = Math.min(dailyPenalty * daysOverdue, (rental.price || 0) * 2);
        
        res.json({
            status: "Success",
            message: `Book is overdue by ${daysOverdue} days`,
            data: {
                isOverdue: true,
                daysOverdue: daysOverdue,
                dailyPenalty: dailyPenalty,
                penaltyAmount: Math.round(totalPenalty * 100) / 100,
                dueDate: rental.due_date,
                bookPrice: rental.price
            }
        });
    });
});

// Proxy endpoint to save member
app.post('/api/members/save', async (req, res) => {
    console.log("Proxying member save request:", req.body);
    
    try {
        const response = await fetch('https://dev-api.humhealth.com/LibraryManagementAPI/members/save', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(req.body)
        });
        
        const data = await response.json();
        console.log("Member API response:", data);
        res.json(data);
    } catch (error) {
        console.error("Proxy error:", error);
        res.status(500).json({ status: "Error", message: error.message });
    }
});

// ============ AUTHENTICATION APIs ============

// Create users table (run this SQL first)
/*
CREATE TABLE IF NOT EXISTS users (
    user_id INT PRIMARY KEY AUTO_INCREMENT,
    name VARCHAR(100) NOT NULL,
    email VARCHAR(150) UNIQUE NOT NULL,
    password VARCHAR(255) NOT NULL,
    created_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);
*/

// Register endpoint
app.post('/api/auth/register', (req, res) => {
    const { name, email, password } = req.body;
    
    if (!name || !email || !password) {
        return res.status(400).json({ status: "Error", message: "All fields are required" });
    }
    
    // Simple hash (in production, use bcrypt)
    const hashedPassword = Buffer.from(password).toString('base64');
    
    const sql = `INSERT INTO users (name, email, password) VALUES (?, ?, ?)`;
    
    db.query(sql, [name, email, hashedPassword], (err, result) => {
        if (err) {
            if (err.code === 'ER_DUP_ENTRY') {
                return res.json({ status: "Error", message: "Email already registered" });
            }
            console.error('Registration error:', err);
            return res.json({ status: "Error", message: err.message });
        }
        
        res.json({ 
            status: "Success", 
            message: "User registered successfully",
            data: { userId: result.insertId, name, email }
        });
    });
});

// ============ ADMIN AUTHENTICATION APIs ============

// Create admin_users table (run this SQL first)
/*
CREATE TABLE IF NOT EXISTS admin_users (
    admin_id INT PRIMARY KEY AUTO_INCREMENT,
    name VARCHAR(100) NOT NULL,
    email VARCHAR(150) UNIQUE NOT NULL,
    password VARCHAR(255) NOT NULL,
    created_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);
*/

// Create default admin account
app.post('/api/auth/create-default-admin', async (req, res) => {
    const defaultAdmin = {
        name: 'Administrator',
        email: 'admin@gmail.com',
        password: 'admin12345'
    };
    
    // Hash password (simple base64 for demo - use bcrypt in production)
    const hashedPassword = Buffer.from(defaultAdmin.password).toString('base64');
    
    const checkSql = `SELECT * FROM admin_users WHERE email = ?`;
    
    db.query(checkSql, [defaultAdmin.email], (err, results) => {
        if (err) {
            return res.json({ status: "Error", message: err.message });
        }
        
        if (results.length > 0) {
            return res.json({ status: "Success", message: "Admin already exists" });
        }
        
        const insertSql = `INSERT INTO admin_users (name, email, password) VALUES (?, ?, ?)`;
        
        db.query(insertSql, [defaultAdmin.name, defaultAdmin.email, hashedPassword], (err, result) => {
            if (err) {
                return res.json({ status: "Error", message: err.message });
            }
            
            res.json({ 
                status: "Success", 
                message: "Default admin created successfully",
                data: { email: defaultAdmin.email, password: defaultAdmin.password }
            });
        });
    });
});

// Admin login endpoint
app.post('/api/auth/admin-login', (req, res) => {
    const { email, password } = req.body;
    
    if (!email || !password) {
        return res.status(400).json({ status: "Error", message: "Email and password are required" });
    }
    
    const hashedPassword = Buffer.from(password).toString('base64');
    
    const sql = `SELECT admin_id, name, email FROM admin_users WHERE email = ? AND password = ?`;
    
    db.query(sql, [email, hashedPassword], (err, results) => {
        if (err) {
            console.error('Admin login error:', err);
            return res.json({ status: "Error", message: err.message });
        }
        
        if (results.length === 0) {
            return res.json({ status: "Error", message: "Invalid email or password" });
        }
        
        const admin = results[0];
        res.json({ 
            status: "Success", 
            message: "Login successful",
            data: { adminId: admin.admin_id, name: admin.name, email: admin.email }
        });
    });
});

// Login endpoint
app.post('/api/auth/login', (req, res) => {
    const { email, password } = req.body;
    
    if (!email || !password) {
        return res.status(400).json({ status: "Error", message: "Email and password are required" });
    }
    
    const hashedPassword = Buffer.from(password).toString('base64');
    
    const sql = `SELECT user_id, name, email FROM users WHERE email = ? AND password = ?`;
    
    db.query(sql, [email, hashedPassword], (err, results) => {
        if (err) {
            console.error('Login error:', err);
            return res.json({ status: "Error", message: err.message });
        }
        
        if (results.length === 0) {
            return res.json({ status: "Error", message: "Invalid email or password" });
        }
        
        const user = results[0];
        res.json({ 
            status: "Success", 
            message: "Login successful",
            data: { userId: user.user_id, name: user.name, email: user.email }
        });
    });
});

// ============ COMPLETE RENTAL APIs WITH RENEWAL TRACKING ============

// 1. GET - Borrowed books for a member
app.get('/api/local/rentals/borrowed/:memberId', (req, res) => {
    const { memberId } = req.params;
    console.log(`📖 Fetching borrowed books for member: ${memberId}`);
    
    const sql = `SELECT 
                    transaction_id as transactionId, 
                    book_id as bookId, 
                    book_title as bookTitle, 
                    DATE_FORMAT(borrowed_date, '%Y-%m-%d') as borrowedDate, 
                    DATE_FORMAT(due_date, '%Y-%m-%d') as returnDate,
                    DATE_FORMAT(actual_return_date, '%Y-%m-%d') as actualReturnDate,
                    rental_status_description as rentalStatusDescription,
                    renewed_count as renewedCount,
                    last_renewed_date as lastRenewedDate,
                    renewed_due_date as renewedDueDate
                FROM rental_transactions 
                WHERE member_id = ? 
                AND actual_return_date IS NULL 
                AND rental_status_description != 'Returned'
                ORDER BY due_date ASC`;
    
    db.query(sql, [memberId], (err, results) => {
        if (err) {
            console.error('Error fetching borrowed books:', err);
            return res.json({ 
                status: "Error", 
                message: err.message,
                data: [] 
            });
        }
        
        console.log(`✅ Found ${results.length} borrowed books for member ${memberId}`);
        res.json({ 
            status: "Success", 
            message: "Borrowed books retrieved successfully", 
            data: results 
        });
    });
});

// 2. POST - Return a book
app.post('/api/local/rentals/return', (req, res) => {
    const { transactionId } = req.body;
    
    console.log(`📚 Returning book - Transaction ID: ${transactionId}`);
    
    if (!transactionId) {
        return res.status(400).json({ 
            status: "Error", 
            message: "Transaction ID is required" 
        });
    }
    
    // First, get the rental details
    const getRentalSql = `SELECT * FROM rental_transactions WHERE transaction_id = ?`;
    
    db.query(getRentalSql, [transactionId], (err, rentals) => {
        if (err) {
            console.error('Error fetching rental:', err);
            return res.json({ status: "Error", message: err.message });
        }
        
        if (rentals.length === 0) {
            return res.json({ status: "Error", message: "Rental transaction not found" });
        }
        
        const rental = rentals[0];
        
        // Check if already returned
        if (rental.actual_return_date !== null) {
            return res.json({ status: "Error", message: "Book already returned" });
        }
        
        // Calculate overdue penalty if any
        const today = new Date();
        const dueDate = new Date(rental.due_date);
        let isOverdue = false;
        let penaltyAmount = 0;
        
        if (today > dueDate) {
            isOverdue = true;
            const daysOverdue = Math.ceil((today - dueDate) / (1000 * 60 * 60 * 24));
            penaltyAmount = Math.min(daysOverdue * 5, 100); // $5 per day, max $100
            
            // Insert penalty record
            const insertPenaltySql = `INSERT INTO penalties (rental_transaction_id, amount, reason_desc, payment_status_description) 
                                      VALUES (?, ?, 'Book returned overdue', 'Pending')`;
            db.query(insertPenaltySql, [transactionId, penaltyAmount], (penaltyErr) => {
                if (penaltyErr) console.error('Error creating penalty:', penaltyErr);
            });
        }
        
        // Update the rental as returned
        const updateSql = `UPDATE rental_transactions 
                          SET actual_return_date = CURDATE(), 
                              rental_status_description = 'Returned' 
                          WHERE transaction_id = ?`;
        
        db.query(updateSql, [transactionId], (updateErr, result) => {
            if (updateErr) {
                console.error('Error updating rental:', updateErr);
                return res.json({ status: "Error", message: updateErr.message });
            }
            
            // Update book status back to Available
            const updateBookSql = `UPDATE books SET status_code_id = 'AVAI' WHERE book_id = ?`;
            db.query(updateBookSql, [rental.book_id], (bookErr) => {
                if (bookErr) console.error('Error updating book status:', bookErr);
            });
            
            console.log(`✅ Book returned successfully - Transaction: ${transactionId}`);
            
            let message = "Book returned successfully!";
            if (isOverdue) {
                message = `Book returned successfully! But it was overdue by ${Math.ceil((today - dueDate) / (1000 * 60 * 60 * 24))} days. Penalty amount: $${penaltyAmount.toFixed(2)}`;
            }
            
            res.json({ 
                status: "Success", 
                message: message,
                data: { 
                    transactionId: transactionId,
                    isOverdue: isOverdue,
                    penaltyAmount: penaltyAmount
                }
            });
        });
    });
});

// 3. RENEW BOOK - Complete working endpoint with database tracking
app.put('/api/local/rentals/renew/:transactionId', (req, res) => {
    const { transactionId } = req.params;
    
    console.log(`🔄 Renewing book - Transaction ID: ${transactionId}`);
    
    if (!transactionId) {
        return res.status(400).json({ 
            status: "Error", 
            message: "Transaction ID is required" 
        });
    }
    
    // Get current rental details
    const getRentalSql = `SELECT * FROM rental_transactions WHERE transaction_id = ?`;
    
    db.query(getRentalSql, [transactionId], (err, rentals) => {
        if (err) {
            console.error('Error fetching rental:', err);
            return res.json({ status: "Error", message: err.message });
        }
        
        if (rentals.length === 0) {
            return res.json({ status: "Error", message: "Rental transaction not found" });
        }
        
        const rental = rentals[0];
        
        // Check if already returned
        if (rental.actual_return_date !== null) {
            return res.json({ status: "Error", message: "Cannot renew: Book has already been returned" });
        }
        
        // Check if already renewed (max 1 renewal)
        if (rental.renewed_count >= 1) {
            return res.json({ status: "Error", message: "Cannot renew: This book has already been renewed once. Maximum renewal limit reached." });
        }
        
        // Check if overdue
        const today = new Date();
        const currentDueDate = new Date(rental.due_date);
        
        if (today > currentDueDate) {
            return res.json({ status: "Error", message: "Cannot renew: Book is overdue. Please return the book first." });
        }
        
        // Calculate new due date (add 5 days to current due date)
        const newDueDate = new Date(currentDueDate);
        newDueDate.setDate(currentDueDate.getDate() + 5);
        const formattedNewDueDate = newDueDate.toISOString().split('T')[0];
        
        // Update the rental with renewal information
        const updateSql = `UPDATE rental_transactions 
                          SET renewed_count = renewed_count + 1,
                              last_renewed_date = CURDATE(),
                              renewed_due_date = ?,
                              due_date = ?,
                              rental_status_description = 'Renewed'
                          WHERE transaction_id = ?`;
        
        db.query(updateSql, [formattedNewDueDate, formattedNewDueDate, transactionId], (updateErr, result) => {
            if (updateErr) {
                console.error('Error updating renewal:', updateErr);
                return res.json({ status: "Error", message: updateErr.message });
            }
            
            // Insert renewal history record
            const insertHistorySql = `INSERT INTO rental_renewals (transaction_id, renewed_date, old_due_date, new_due_date, renewed_by) 
                                      VALUES (?, CURDATE(), ?, ?, 'member')`;
            
            db.query(insertHistorySql, [transactionId, rental.due_date.toISOString().split('T')[0], formattedNewDueDate], (historyErr) => {
                if (historyErr) {
                    console.error('Error inserting renewal history:', historyErr);
                    // Don't fail the request, just log the error
                }
            });
            
            console.log(`✅ Book renewed successfully - Transaction: ${transactionId}, New Due Date: ${formattedNewDueDate}`);
            
            res.json({ 
                status: "Success", 
                message: `Book renewed successfully! New due date: ${formattedNewDueDate}`,
                data: { 
                    transactionId: transactionId,
                    oldDueDate: rental.due_date,
                    newDueDate: formattedNewDueDate,
                    renewedCount: (rental.renewed_count || 0) + 1
                }
            });
        });
    });
});

// 4. POST - Borrow a book (Enhanced)
app.post('/api/local/rentals/borrow', (req, res) => {
    const { memberId, bookId, bookTitle, dueDate } = req.body;
    
    console.log(`📖 Borrowing book - Member: ${memberId}, Book: ${bookId}, Title: ${bookTitle}`);
    
    if (!memberId || !bookId) {
        return res.status(400).json({ 
            status: "Error", 
            message: "Member ID and Book ID are required" 
        });
    }
    
    // Calculate due date (10 days from now if not provided)
    let finalDueDate = dueDate;
    if (!finalDueDate) {
        const date = new Date();
        date.setDate(date.getDate() + 10);
        finalDueDate = date.toISOString().split('T')[0];
    }
    
    // Check if book is available
    const checkBookSql = `SELECT status_code_id, book_count FROM books WHERE book_id = ?`;
    db.query(checkBookSql, [bookId], (checkErr, books) => {
        if (checkErr) {
            return res.json({ status: "Error", message: checkErr.message });
        }
        
        if (books.length === 0) {
            return res.json({ status: "Error", message: "Book not found" });
        }
        
        if (books[0].status_code_id !== 'AVAI') {
            return res.json({ status: "Error", message: "Book is not available for borrowing" });
        }
        
        // Insert rental transaction
        const sql = `INSERT INTO rental_transactions (member_id, book_id, book_title, borrowed_date, due_date, rental_status_description, renewed_count) 
                     VALUES (?, ?, ?, CURDATE(), ?, 'Borrowed', 0)`;
        
        db.query(sql, [memberId, bookId, bookTitle, finalDueDate], (err, result) => {
            if (err) {
                console.error('Error borrowing book:', err);
                return res.json({ status: "Error", message: err.message });
            }
            
            // Update book status to Not Available and decrease count
            const updateBookSql = `UPDATE books SET status_code_id = 'NAVAI', book_count = book_count - 1 WHERE book_id = ?`;
            db.query(updateBookSql, [bookId], (updateErr) => {
                if (updateErr) console.error('Error updating book status:', updateErr);
            });
            
            console.log(`✅ Book borrowed successfully - Transaction ID: ${result.insertId}`);
            
            res.json({ 
                status: "Success", 
                message: `Book borrowed successfully! Due date: ${finalDueDate}`,
                data: { 
                    transactionId: result.insertId,
                    dueDate: finalDueDate
                }
            });
        });
    });
});

// 5. GET - Rental history with renewals info
app.get('/api/local/rentals/history/:memberId', (req, res) => {
    const { memberId } = req.params;
    
    const sql = `SELECT 
                    r.transaction_id as transactionId,
                    r.book_id as bookId,
                    r.book_title as bookTitle,
                    DATE_FORMAT(r.borrowed_date, '%Y-%m-%d') as borrowedDate,
                    DATE_FORMAT(r.due_date, '%Y-%m-%d') as dueDate,
                    DATE_FORMAT(r.actual_return_date, '%Y-%m-%d') as actualReturnDate,
                    r.rental_status_description as status,
                    r.renewed_count as renewedCount,
                    DATE_FORMAT(r.last_renewed_date, '%Y-%m-%d') as lastRenewedDate,
                    DATE_FORMAT(r.renewed_due_date, '%Y-%m-%d') as renewedDueDate
                FROM rental_transactions r
                WHERE r.member_id = ?
                ORDER BY r.transaction_id DESC`;
    
    db.query(sql, [memberId], (err, results) => {
        if (err) {
            return res.json({ status: "Error", message: err.message, data: [] });
        }
        
        res.json({ 
            status: "Success", 
            message: "Rental history retrieved", 
            data: results 
        });
    });
});

// 6. GET - Renewal history for a specific rental
app.get('/api/local/rentals/renewal-history/:transactionId', (req, res) => {
    const { transactionId } = req.params;
    
    const sql = `SELECT 
                    renewal_id as renewalId,
                    transaction_id as transactionId,
                    DATE_FORMAT(renewed_date, '%Y-%m-%d') as renewedDate,
                    DATE_FORMAT(old_due_date, '%Y-%m-%d') as oldDueDate,
                    DATE_FORMAT(new_due_date, '%Y-%m-%d') as newDueDate,
                    renewed_by as renewedBy,
                    created_at as createdAt
                FROM rental_renewals
                WHERE transaction_id = ?
                ORDER BY renewal_id DESC`;
    
    db.query(sql, [transactionId], (err, results) => {
        if (err) {
            return res.json({ status: "Error", message: err.message, data: [] });
        }
        
        res.json({ 
            status: "Success", 
            message: "Renewal history retrieved", 
            data: results 
        });
    });
});

// 7. GET - Rental statistics
app.get('/api/local/rentals/stats/:memberId', (req, res) => {
    const { memberId } = req.params;
    
    const sql = `SELECT 
                    COUNT(CASE WHEN actual_return_date IS NULL AND due_date >= CURDATE() THEN 1 END) as currentlyBorrowed,
                    COUNT(CASE WHEN actual_return_date IS NULL AND due_date < CURDATE() THEN 1 END) as overdueCount,
                    COUNT(CASE WHEN renewed_count > 0 THEN 1 END) as renewedCount,
                    COUNT(*) as totalRentals
                FROM rental_transactions 
                WHERE member_id = ?`;
    
    db.query(sql, [memberId], (err, results) => {
        if (err) {
            return res.json({ status: "Error", message: err.message });
        }
        
        res.json({ 
            status: "Success", 
            data: results[0] || { currentlyBorrowed: 0, overdueCount: 0, renewedCount: 0, totalRentals: 0 }
        });
    });
});

// ============ RENTAL APIs ============

app.post('/api/local/rentals/borrow', (req, res) => {
    const { memberId, bookId, bookTitle, dueDate } = req.body;
    
    if (!memberId || !bookId) {
        return res.status(400).json({ status: "Error", message: "Member ID and Book ID are required" });
    }
    
    const sql = `INSERT INTO rental_transactions (member_id, book_id, book_title, borrowed_date, due_date, rental_status_description) 
                 VALUES (?, ?, ?, CURDATE(), ?, 'Borrowed')`;
    
    db.query(sql, [memberId, bookId, bookTitle, dueDate], (err, result) => {
        if (err) {
            console.error('Error borrowing book:', err);
            return res.json({ status: "Error", message: err.message });
        }
        res.json({ status: "Success", message: "Book borrowed successfully!", data: { transactionId: result.insertId } });
    });
});

app.get('/api/local/rentals/borrowed/:memberId', (req, res) => {
    const { memberId } = req.params;
    const sql = `SELECT transaction_id as transactionId, book_id as bookId, book_title as bookTitle, borrowed_date as borrowedDate, due_date as returnDate, rental_status_description as rentalStatusDescription FROM rental_transactions WHERE member_id = ? AND actual_return_date IS NULL ORDER BY transaction_id DESC`;
    db.query(sql, [memberId], (err, results) => {
        if (err) return res.json({ status: "Error", message: err.message });
        res.json({ status: "Success", message: "Borrowed books retrieved successfully", data: results });
    });
});

// ============ PURCHASES API ============

app.post('/api/purchases/add', (req, res) => {
    const { memberId, bookId, title, author, price, purchaseDate } = req.body;
    const sql = `INSERT INTO purchases (member_id, book_id, title, author, price, purchase_date) VALUES (?, ?, ?, ?, ?, ?)`;
    db.query(sql, [memberId, bookId, title, author, price, purchaseDate], (err, result) => {
        if (err) return res.json({ status: "Error", message: err.message });
        res.json({ status: "Success", message: "Book purchased successfully!", data: { purchaseId: result.insertId } });
    });
});

// ============ HEALTH CHECK ============

app.get('/api/health', (req, res) => {
    res.json({ 
        status: "OK", 
        timestamp: new Date().toISOString(),
        message: "Backend server is running!",
        database: "Connected"
    });
});
// ============ GET ALL RENTALS (INCLUDING RETURNED) FOR ADMIN ============
app.get('/api/local/rentals/all/:memberId', (req, res) => {
    const { memberId } = req.params;
    
    console.log(`📋 Fetching all rentals for memberId: ${memberId}`);
    
    let sql;
    let params;
    
    if (memberId && memberId != 0 && memberId != '0') {
        // Get rentals for specific member
        sql = `SELECT 
                    transaction_id as transactionId, 
                    member_id as memberId,
                    book_id as bookId, 
                    book_title as bookTitle, 
                    DATE_FORMAT(borrowed_date, '%Y-%m-%d') as borrowedDate, 
                    DATE_FORMAT(due_date, '%Y-%m-%d') as dueDate,
                    DATE_FORMAT(actual_return_date, '%Y-%m-%d') as actualReturnDate,
                    rental_status_description as rentalStatusDescription,
                    renewed_count as renewedCount,
                    last_renewed_date as lastRenewedDate,
                    renewed_due_date as renewedDueDate
                FROM rental_transactions 
                WHERE member_id = ?
                ORDER BY transaction_id DESC`;
        params = [memberId];
    } else {
        // Get all rentals for admin
        sql = `SELECT 
                    transaction_id as transactionId, 
                    member_id as memberId,
                    book_id as bookId, 
                    book_title as bookTitle, 
                    DATE_FORMAT(borrowed_date, '%Y-%m-%d') as borrowedDate, 
                    DATE_FORMAT(due_date, '%Y-%m-%d') as dueDate,
                    DATE_FORMAT(actual_return_date, '%Y-%m-%d') as actualReturnDate,
                    rental_status_description as rentalStatusDescription,
                    renewed_count as renewedCount,
                    last_renewed_date as lastRenewedDate,
                    renewed_due_date as renewedDueDate
                FROM rental_transactions 
                ORDER BY transaction_id DESC`;
        params = [];
    }
    
    db.query(sql, params, (err, results) => {
        if (err) {
            console.error('Error fetching all rentals:', err);
            return res.json({ 
                status: "Error", 
                message: err.message,
                data: [] 
            });
        }
        
        console.log(`✅ Found ${results.length} total rentals`);
        res.json({ 
            status: "Success", 
            message: "All rentals retrieved successfully", 
            data: results 
        });
    });
});

// ============ START SERVER ============

const PORT = 8080;
app.listen(PORT, () => {
    console.log(`\n🚀 Backend server running on http://localhost:${PORT}`);
    console.log(`📚 API endpoints ready:`);
    console.log(`   GET  /api/health - Health check`);
    console.log(`   GET  /api/local/books/list - Get local books only`);
    console.log(`   GET  /api/books/all - Get books from BOTH Local DB + Company API`);
    console.log(`   POST /api/local/books/add - Add/Update book to local DB (UPSERT)`);
    console.log(`   PUT  /api/local/books/update/:bookId - Update book`);
    console.log(`   POST /api/favorites/add - Add to favorites`);
    console.log(`   POST /api/cart/add - Add to cart`);
    console.log(`   POST /api/local/rentals/borrow - Borrow book`);
    console.log(`   GET  /api/local/rentals/borrowed/:memberId - Get borrowed books`);
    console.log(`   POST /api/local/rentals/return - Return book`);
    console.log(`   PUT  /api/local/rentals/renew/:transactionId - Renew book`);
    console.log(`\n✅ Connected to MySQL database\n`);
});