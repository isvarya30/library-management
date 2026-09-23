// ============================================================
//  server.js  —  Library Management Backend
//  Ready for: Render (Node) + TiDB Cloud (MySQL-compatible)
// ============================================================
require('dotenv').config();

const express = require('express');
const mysql   = require('mysql2');
const cors    = require('cors');
const https   = require('https');
const http    = require('http');
const fs      = require('fs');
const path    = require('path');

const app = express();
app.use(cors());
app.use(express.json({ limit: '5mb' }));
app.use(express.urlencoded({ extended: true }));

// ------------------------------------------------------------
//  MySQL / TiDB Cloud Connection
// ------------------------------------------------------------
// TiDB Cloud requires TLS. We load ca.pem if it exists locally,
// otherwise fall back to non-SSL for local MySQL development.
const caPath = path.join(__dirname, 'ca.pem');
const sslConfig = fs.existsSync(caPath)
    ? { ca: fs.readFileSync(caPath), minVersion: 'TLSv1.2', rejectUnauthorized: true }
    : undefined;

const db = mysql.createPool({
    host:     process.env.DB_HOST     || 'localhost',
    user:     process.env.DB_USER     || 'root',
    password: process.env.DB_PASSWORD || 'Anu@12345',
    database: process.env.DB_NAME     || 'library_management',
    port:     parseInt(process.env.DB_PORT) || 3306,
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0,
    dateStrings: true,
    ...(sslConfig && { ssl: sslConfig })
});

db.getConnection((err, connection) => {
    if (err) {
        console.error('❌ Database connection failed:', err.message);
        return;
    }
    console.log('✅ Connected to MySQL database');
    connection.release();
});

const COMPANY_API = process.env.COMPANY_API || 'https://dev-api.humhealth.com/LibraryManagementAPI';

// ------------------------------------------------------------
//  HTTP helper (used for calling the Company API)
// ------------------------------------------------------------
function makeRequest(url, data, method = 'POST') {
    return new Promise((resolve, reject) => {
        const urlObj = new URL(url);
        const options = {
            hostname: urlObj.hostname,
            port:     urlObj.port || (urlObj.protocol === 'https:' ? 443 : 80),
            path:     urlObj.pathname + urlObj.search,
            method,
            headers: {
                'Content-Type': 'application/json',
                'Accept':       'application/json'
            }
        };

        const body = (method === 'POST' || method === 'PUT') && data
            ? JSON.stringify(data)
            : null;

        if (body) options.headers['Content-Length'] = Buffer.byteLength(body);

        const client = urlObj.protocol === 'https:' ? https : http;
        const req = client.request(options, (res) => {
            let responseData = '';
            res.on('data', (chunk) => { responseData += chunk; });
            res.on('end', () => {
                try {
                    resolve(JSON.parse(responseData));
                } catch {
                    resolve({ status: 'Error', message: 'Invalid JSON response', raw: responseData });
                }
            });
        });

        req.on('error', reject);
        req.setTimeout(10000, () => {
            req.destroy(new Error('Request timeout'));
        });

        if (body) req.write(body);
        req.end();
    });
}

// ============================================================
//  BOOKS
// ============================================================

function insertNewBook(title, author, language, genre, price, statusCodeId, bookCount, res) {
    const sql = `INSERT INTO books
                 (title, author, language, genre, price, status_code_id, book_count, book_register_date)
                 VALUES (?, ?, ?, ?, ?, ?, ?, CURDATE())`;
    db.query(sql,
        [title, author, language, genre || null, price, statusCodeId || 'AVAI', bookCount || 1],
        (err, result) => {
            if (err) {
                console.error('Error inserting book:', err);
                return res.status(500).json({ status: 'Error', message: err.message });
            }
            res.json({
                status: 'Success',
                message: 'New book added successfully!',
                data: { bookId: result.insertId, action: 'inserted' }
            });
        });
}

// UPSERT book
app.post('/api/local/books/add', (req, res) => {
    const { bookId, title, author, language, genre, price, statusCodeId, bookCount } = req.body;

    if (!title || !author || !language || !price) {
        return res.status(400).json({
            status: 'Error',
            message: 'Missing required fields: title, author, language, price'
        });
    }

    if (bookId && bookId > 0) {
        const checkSql = `SELECT book_id FROM books WHERE book_id = ? AND book_deleted_date IS NULL`;
        db.query(checkSql, [bookId], (checkErr, checkResult) => {
            if (checkErr) {
                return res.status(500).json({ status: 'Error', message: checkErr.message });
            }
            if (checkResult.length > 0) {
                const updateSql = `UPDATE books
                                   SET title = ?, author = ?, language = ?, genre = ?,
                                       price = ?, status_code_id = ?, book_count = ?,
                                       updated_date = CURRENT_TIMESTAMP
                                   WHERE book_id = ? AND book_deleted_date IS NULL`;
                db.query(updateSql,
                    [title, author, language, genre || null, price,
                     statusCodeId || 'AVAI', bookCount || 1, bookId],
                    (err) => {
                        if (err) return res.status(500).json({ status: 'Error', message: err.message });
                        res.json({
                            status: 'Success',
                            message: 'Book updated successfully!',
                            data: { bookId, action: 'updated' }
                        });
                    });
            } else {
                insertNewBook(title, author, language, genre, price, statusCodeId, bookCount, res);
            }
        });
    } else {
        insertNewBook(title, author, language, genre, price, statusCodeId, bookCount, res);
    }
});

// Local list
app.get('/api/local/books/list', (req, res) => {
    const sql = `SELECT book_id AS bookId, title, author, language, genre, price,
                        status_code_id AS statusCodeId,
                        DATE_FORMAT(book_register_date, '%Y-%m-%d') AS bookRegisterDate,
                        book_count AS bookCount
                 FROM books
                 WHERE book_deleted_date IS NULL
                 ORDER BY book_id DESC`;
    db.query(sql, (err, results) => {
        if (err) return res.status(500).json({ status: 'Error', message: err.message, data: [] });
        res.json({ status: 'Success', message: 'Local books fetched successfully', data: results });
    });
});

// Single book
app.get('/api/local/books/:bookId', (req, res) => {
    const { bookId } = req.params;
    const sql = `SELECT book_id AS bookId, title, author, language, genre, price,
                        status_code_id AS statusCodeId,
                        book_register_date AS bookRegisterDate,
                        book_count AS bookCount
                 FROM books
                 WHERE book_id = ? AND book_deleted_date IS NULL`;
    db.query(sql, [bookId], (err, results) => {
        if (err) return res.status(500).json({ status: 'Error', message: err.message });
        if (results.length === 0)
            return res.status(404).json({ status: 'Error', message: `Book with ID ${bookId} not found` });
        res.json({ status: 'Success', message: 'Book retrieved successfully', data: results[0] });
    });
});

// Update book
app.put('/api/local/books/update/:bookId', (req, res) => {
    const { bookId } = req.params;
    const { title, author, language, genre, price, statusCodeId, bookCount } = req.body;

    if (!title || !author || !language || !price) {
        return res.status(400).json({ status: 'Error', message: 'Missing required fields' });
    }

    const sql = `UPDATE books
                 SET title = ?, author = ?, language = ?, genre = ?, price = ?,
                     status_code_id = ?, book_count = ?, updated_date = CURRENT_TIMESTAMP
                 WHERE book_id = ? AND book_deleted_date IS NULL`;
    db.query(sql,
        [title, author, language, genre, price, statusCodeId || 'AVAI', bookCount || 1, bookId],
        (err, result) => {
            if (err) return res.status(500).json({ status: 'Error', message: err.message });
            if (result.affectedRows === 0)
                return res.status(404).json({ status: 'Error', message: `Book with ID ${bookId} not found` });
            res.json({ status: 'Success', message: 'Book updated successfully!', data: { bookId } });
        });
});

// Combined books (local + company API)
app.get('/api/books/all', async (req, res) => {
    console.log('\n📚 Fetching books from both Local DB and Company API...');

    let errors = [];

    const localPromise = new Promise((resolve) => {
        const sql = `SELECT book_id AS bookId, title, author, language, genre, price,
                            status_code_id AS statusCodeId,
                            book_register_date AS bookRegisterDate,
                            book_count AS bookCount,
                            'Local DB' AS source
                     FROM books
                     WHERE book_deleted_date IS NULL
                     ORDER BY book_id DESC`;
        db.query(sql, (err, results) => {
            if (err) {
                console.error('❌ Local DB error:', err);
                errors.push(`Local DB error: ${err.message}`);
                return resolve([]);
            }
            console.log(`✅ Retrieved ${results.length} books from Local DB`);
            resolve(results);
        });
    });

    const apiPromise = (async () => {
        try {
            const payload = {
                start: 0, length: 100, searchValue: '',
                order: { sortType: 'asc', sortColumn: 'title' },
                filter: { language: '', genre: '', statusCode: '' }
            };
            const result = await makeRequest(`${COMPANY_API}/books/list`, payload, 'POST');
            let books = [];
            if (result.status === 'Success' && Array.isArray(result.data)) books = result.data;
            else if (Array.isArray(result.books)) books = result.books;
            books = books.map(b => ({ ...b, source: 'Company API' }));
            console.log(`✅ Retrieved ${books.length} books from Company API`);
            return books;
        } catch (error) {
            console.error('❌ Company API error:', error.message);
            errors.push(`Company API error: ${error.message}`);
            return [];
        }
    })();

    const [localBooks, apiBooks] = await Promise.all([localPromise, apiPromise]);

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

    console.log(`📊 Combined: ${uniqueBooks.length} unique books`);

    res.json({
        status: 'Success',
        message: `Loaded ${uniqueBooks.length} books (${apiBooks.length} from API, ${localBooks.length} from Local DB)`,
        data: uniqueBooks,
        details: {
            apiCount: apiBooks.length,
            localCount: localBooks.length,
            totalUnique: uniqueBooks.length,
            errors: errors.length ? errors : null
        }
    });
});

// ============================================================
//  MEMBERS
// ============================================================

app.post('/api/local/members/save', (req, res) => {
    const {
        memberId, memberFirstName, memberMiddleName, memberLastName,
        memberEmail, memberMobileNumber, memberDob,
        memberAddressLine1, memberAddressLine2,
        memberWorkStatus, membershipPeriod
    } = req.body;

    if (!memberFirstName || !memberLastName || !memberEmail || !memberMobileNumber || !memberDob) {
        return res.status(400).json({ status: 'Error', message: 'Missing required fields' });
    }

    const workStatusDesc = memberWorkStatus === 'STUD' ? 'Student' : 'Employee';
    const periodMonths = parseInt(membershipPeriod) || 12;

    if (memberId && memberId !== '') {
        const sql = `UPDATE members
                     SET member_first_name = ?, member_middle_name = ?, member_last_name = ?,
                         member_email = ?, member_mobile_number = ?, member_dob = ?,
                         member_address_line1 = ?, member_address_line2 = ?,
                         member_work_status = ?, member_work_status_description = ?,
                         member_end_date = DATE_ADD(CURDATE(), INTERVAL ? MONTH),
                         updated_date = CURRENT_TIMESTAMP
                     WHERE member_id = ?`;
        db.query(sql,
            [memberFirstName, memberMiddleName || '', memberLastName, memberEmail,
             memberMobileNumber, memberDob, memberAddressLine1, memberAddressLine2 || '',
             memberWorkStatus, workStatusDesc, periodMonths, memberId],
            (err) => {
                if (err) {
                    if (err.code === 'ER_DUP_ENTRY')
                        return res.json({ status: 'Error', message: 'Email or mobile already exists' });
                    return res.json({ status: 'Error', message: err.message });
                }
                res.json({ status: 'Success', message: 'Member updated successfully!', data: `Member ID:${memberId}` });
            });
    } else {
        const endDate = new Date();
        endDate.setMonth(endDate.getMonth() + periodMonths);
        const sql = `INSERT INTO members
                     (member_first_name, member_middle_name, member_last_name, member_email,
                      member_mobile_number, member_dob, member_address_line1, member_address_line2,
                      member_work_status, member_work_status_description,
                      member_start_date, member_end_date,
                      membership_status, membership_status_description)
                     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURDATE(), ?, 'ACTIVE', 'Active')`;
        db.query(sql,
            [memberFirstName, memberMiddleName || '', memberLastName, memberEmail,
             memberMobileNumber, memberDob, memberAddressLine1, memberAddressLine2 || '',
             memberWorkStatus, workStatusDesc, endDate.toISOString().split('T')[0]],
            (err, result) => {
                if (err) {
                    if (err.code === 'ER_DUP_ENTRY')
                        return res.json({ status: 'Error', message: 'Email or mobile already exists' });
                    return res.json({ status: 'Error', message: err.message });
                }
                res.json({ status: 'Success', message: 'Member registered successfully!', data: `Member ID:${result.insertId}` });
            });
    }
});

app.post('/api/local/members/list', (req, res) => {
    const sql = `SELECT member_id AS memberId,
                        member_first_name AS memberFirstName,
                        member_middle_name AS memberMiddleName,
                        member_last_name AS memberLastName,
                        member_email AS memberEmail,
                        member_mobile_number AS memberMobileNumber,
                        member_dob AS memberDob,
                        member_address_line1 AS memberAddressLine1,
                        member_address_line2 AS memberAddressLine2,
                        member_work_status AS memberWorkStatus,
                        member_work_status_description AS memberWorkStatusDescription,
                        member_start_date AS memberStartDate,
                        member_end_date AS memberEndDate,
                        membership_status AS membershipStatus,
                        membership_status_description AS membershipStatusDescription
                 FROM members
                 ORDER BY member_id DESC`;
    db.query(sql, (err, results) => {
        if (err) return res.json({ status: 'Error', message: err.message, members: [] });
        res.json({ status: 'Success', members: results, data: results });
    });
});

app.put('/api/local/members/activate', (req, res) => {
    const { membershipPeriod } = req.query;
    const memberIds = req.body;
    if (!Array.isArray(memberIds) || memberIds.length === 0) {
        return res.status(400).json({ status: 'Error', message: 'No member IDs' });
    }
    const periodMonths = parseInt(membershipPeriod) || 12;
    const memberId = memberIds[0];
    const sql = `UPDATE members
                 SET membership_status = 'ACTIVE',
                     membership_status_description = 'Active',
                     member_start_date = CURDATE(),
                     member_end_date = DATE_ADD(CURDATE(), INTERVAL ? MONTH),
                     updated_date = CURRENT_TIMESTAMP
                 WHERE member_id = ?`;
    db.query(sql, [periodMonths, memberId], (err) => {
        if (err) return res.json({ status: 'Error', message: err.message });
        res.json({ status: 'Success', message: 'Member activated successfully!', data: memberIds });
    });
});

app.get('/api/local/members/:memberId', (req, res) => {
    const { memberId } = req.params;
    db.query(`SELECT * FROM members WHERE member_id = ?`, [memberId], (err, results) => {
        if (err || results.length === 0)
            return res.json({ status: 'Error', message: 'Member not found' });
        res.json({ status: 'Success', data: results[0] });
    });
});

// ============================================================
//  FAVORITES
// ============================================================

app.post('/api/favorites/add', (req, res) => {
    const { memberId, bookId, title, author, price } = req.body;
    if (!memberId || !bookId)
        return res.status(400).json({ status: 'Error', message: 'Member ID and Book ID are required' });

    db.query(`SELECT * FROM favorites WHERE member_id = ? AND book_id = ?`, [memberId, bookId], (err, results) => {
        if (err) return res.json({ status: 'Error', message: err.message });
        if (results.length > 0) return res.json({ status: 'Error', message: 'Book already in favorites' });

        db.query(
            `INSERT INTO favorites (member_id, book_id, title, author, price, added_date) VALUES (?, ?, ?, ?, ?, CURDATE())`,
            [memberId, bookId, title, author, price],
            (err2, result) => {
                if (err2) return res.json({ status: 'Error', message: err2.message });
                res.json({ status: 'Success', message: 'Book added to favorites', data: { favoriteId: result.insertId } });
            });
    });
});

app.delete('/api/favorites/remove', (req, res) => {
    const { memberId, bookId } = req.body;
    db.query(`DELETE FROM favorites WHERE member_id = ? AND book_id = ?`, [memberId, bookId], (err) => {
        if (err) return res.json({ status: 'Error', message: err.message });
        res.json({ status: 'Success', message: 'Book removed from favorites' });
    });
});

app.get('/api/favorites/list/:memberId', (req, res) => {
    const { memberId } = req.params;
    db.query(`SELECT * FROM favorites WHERE member_id = ? ORDER BY added_date DESC`, [memberId], (err, results) => {
        if (err) return res.json({ status: 'Error', message: err.message });
        res.json({ status: 'Success', message: 'Favorites retrieved successfully', data: results });
    });
});

app.get('/api/favorites/check/:memberId/:bookId', (req, res) => {
    const { memberId, bookId } = req.params;
    db.query(`SELECT * FROM favorites WHERE member_id = ? AND book_id = ?`, [memberId, bookId], (err, results) => {
        if (err) return res.json({ status: 'Error', message: err.message });
        res.json({ status: 'Success', isFavorite: results.length > 0, data: results[0] || null });
    });
});

// ============================================================
//  CART
// ============================================================

app.post('/api/cart/add', (req, res) => {
    const { memberId, bookId, title, author, price } = req.body;
    if (!memberId || !bookId)
        return res.status(400).json({ status: 'Error', message: 'Member ID and Book ID are required' });

    db.query(`SELECT * FROM cart WHERE member_id = ? AND book_id = ? AND status = 'active'`, [memberId, bookId], (err, results) => {
        if (err) return res.json({ status: 'Error', message: err.message });
        if (results.length > 0) return res.json({ status: 'Error', message: 'Book already in cart' });

        db.query(
            `INSERT INTO cart (member_id, book_id, title, author, price, added_date, status) VALUES (?, ?, ?, ?, ?, CURDATE(), 'active')`,
            [memberId, bookId, title, author, price],
            (err2, result) => {
                if (err2) return res.json({ status: 'Error', message: err2.message });
                res.json({ status: 'Success', message: 'Book added to cart', data: { cartId: result.insertId } });
            });
    });
});

app.delete('/api/cart/remove', (req, res) => {
    const { memberId, bookId } = req.body;
    db.query(`UPDATE cart SET status = 'removed', removed_date = CURDATE() WHERE member_id = ? AND book_id = ? AND status = 'active'`,
        [memberId, bookId], (err) => {
            if (err) return res.json({ status: 'Error', message: err.message });
            res.json({ status: 'Success', message: 'Book removed from cart' });
        });
});

app.get('/api/cart/list/:memberId', (req, res) => {
    const { memberId } = req.params;
    db.query(`SELECT * FROM cart WHERE member_id = ? AND status = 'active' ORDER BY added_date DESC`,
        [memberId], (err, results) => {
            if (err) return res.json({ status: 'Error', message: err.message });
            res.json({ status: 'Success', message: 'Cart retrieved successfully', data: results });
        });
});

app.get('/api/cart/check/:memberId/:bookId', (req, res) => {
    const { memberId, bookId } = req.params;
    db.query(`SELECT * FROM cart WHERE member_id = ? AND book_id = ? AND status = 'active'`,
        [memberId, bookId], (err, results) => {
            if (err) return res.json({ status: 'Error', message: err.message });
            res.json({ status: 'Success', isInCart: results.length > 0, data: results[0] || null });
        });
});

// ============================================================
//  RENTALS
// ============================================================

// Borrow
app.post('/api/local/rentals/borrow', (req, res) => {
    const { memberId, bookId, bookTitle, dueDate } = req.body;

    if (!memberId || !bookId) {
        return res.status(400).json({ status: 'Error', message: 'Member ID and Book ID are required' });
    }

    let finalDueDate = dueDate;
    if (!finalDueDate) {
        const d = new Date();
        d.setDate(d.getDate() + 10);
        finalDueDate = d.toISOString().split('T')[0];
    }

    db.query(`SELECT status_code_id, book_count FROM books WHERE book_id = ?`, [bookId], (checkErr, books) => {
        if (checkErr) return res.json({ status: 'Error', message: checkErr.message });
        if (books.length === 0) return res.json({ status: 'Error', message: 'Book not found' });
        if (books[0].status_code_id !== 'AVAI')
            return res.json({ status: 'Error', message: 'Book is not available for borrowing' });

        const sql = `INSERT INTO rental_transactions
                     (member_id, book_id, book_title, borrowed_date, due_date, rental_status_description, renewed_count)
                     VALUES (?, ?, ?, CURDATE(), ?, 'Borrowed', 0)`;
        db.query(sql, [memberId, bookId, bookTitle, finalDueDate], (err, result) => {
            if (err) return res.json({ status: 'Error', message: err.message });

            db.query(`UPDATE books SET status_code_id = 'NAVAI',
                                      book_count = GREATEST(book_count - 1, 0)
                      WHERE book_id = ?`, [bookId], (uErr) => {
                if (uErr) console.error('Error updating book:', uErr);
            });

            res.json({
                status: 'Success',
                message: `Book borrowed successfully! Due date: ${finalDueDate}`,
                data: { transactionId: result.insertId, dueDate: finalDueDate, daysToReturn: 10 }
            });
        });
    });
});

// Borrowed list for member
app.get('/api/local/rentals/borrowed/:memberId', (req, res) => {
    const { memberId } = req.params;
    const sql = `SELECT transaction_id AS transactionId,
                        book_id AS bookId,
                        book_title AS bookTitle,
                        DATE_FORMAT(borrowed_date, '%Y-%m-%d') AS borrowedDate,
                        DATE_FORMAT(due_date, '%Y-%m-%d') AS returnDate,
                        DATE_FORMAT(actual_return_date, '%Y-%m-%d') AS actualReturnDate,
                        rental_status_description AS rentalStatusDescription,
                        renewed_count AS renewedCount,
                        last_renewed_date AS lastRenewedDate,
                        renewed_due_date AS renewedDueDate
                 FROM rental_transactions
                 WHERE member_id = ?
                   AND actual_return_date IS NULL
                   AND rental_status_description != 'Returned'
                 ORDER BY due_date ASC`;
    db.query(sql, [memberId], (err, results) => {
        if (err) return res.json({ status: 'Error', message: err.message, data: [] });
        res.json({ status: 'Success', message: 'Borrowed books retrieved successfully', data: results });
    });
});

// Return
app.post('/api/local/rentals/return', (req, res) => {
    const { transactionId } = req.body;
    if (!transactionId)
        return res.status(400).json({ status: 'Error', message: 'Transaction ID is required' });

    db.query(`SELECT * FROM rental_transactions WHERE transaction_id = ?`, [transactionId], (err, rentals) => {
        if (err) return res.json({ status: 'Error', message: err.message });
        if (rentals.length === 0) return res.json({ status: 'Error', message: 'Rental transaction not found' });

        const rental = rentals[0];
        if (rental.actual_return_date !== null)
            return res.json({ status: 'Error', message: 'Book already returned' });

        const today   = new Date();
        const dueDate = new Date(rental.due_date);
        let isOverdue = false;
        let penaltyAmount = 0;

        if (today > dueDate) {
            isOverdue = true;
            const daysOverdue = Math.ceil((today - dueDate) / 86400000);
            penaltyAmount = Math.min(daysOverdue * 5, 100);

            db.query(`INSERT INTO penalties
                      (rental_transaction_id, amount, reason_desc, payment_status_description)
                      VALUES (?, ?, 'Book returned overdue', 'Pending')`,
                [transactionId, penaltyAmount],
                (pErr) => { if (pErr) console.error('Error creating penalty:', pErr); });
        }

        db.query(`UPDATE rental_transactions
                  SET actual_return_date = CURDATE(),
                      rental_status_description = 'Returned'
                  WHERE transaction_id = ?`,
            [transactionId],
            (uErr) => {
                if (uErr) return res.json({ status: 'Error', message: uErr.message });

                db.query(`UPDATE books SET status_code_id = 'AVAI',
                                          book_count = book_count + 1
                          WHERE book_id = ?`, [rental.book_id], (bErr) => {
                    if (bErr) console.error('Error updating book status:', bErr);
                });

                const msg = isOverdue
                    ? `Book returned! Overdue by ${Math.ceil((today - dueDate) / 86400000)} days. Penalty: $${penaltyAmount.toFixed(2)}`
                    : 'Book returned successfully! No penalty.';

                res.json({
                    status: 'Success',
                    message: msg,
                    data: { transactionId, isOverdue, penaltyAmount }
                });
            });
    });
});

// Renew
app.put('/api/local/rentals/renew/:transactionId', (req, res) => {
    const { transactionId } = req.params;

    db.query(`SELECT * FROM rental_transactions WHERE transaction_id = ?`, [transactionId], (err, rentals) => {
        if (err) return res.json({ status: 'Error', message: err.message });
        if (rentals.length === 0) return res.json({ status: 'Error', message: 'Rental transaction not found' });

        const rental = rentals[0];

        if (rental.actual_return_date !== null)
            return res.json({ status: 'Error', message: 'Cannot renew: Book has already been returned' });
        if (rental.renewed_count >= 1)
            return res.json({ status: 'Error', message: 'Cannot renew: Maximum renewal limit reached' });

        const today = new Date();
        const currentDueDate = new Date(rental.due_date);
        if (today > currentDueDate)
            return res.json({ status: 'Error', message: 'Cannot renew: Book is overdue' });

        const newDueDate = new Date(currentDueDate);
        newDueDate.setDate(currentDueDate.getDate() + 5);
        const formattedNewDueDate = newDueDate.toISOString().split('T')[0];

        const updateSql = `UPDATE rental_transactions
                           SET renewed_count = renewed_count + 1,
                               last_renewed_date = CURDATE(),
                               renewed_due_date = ?,
                               due_date = ?,
                               rental_status_description = 'Renewed'
                           WHERE transaction_id = ?`;
        db.query(updateSql, [formattedNewDueDate, formattedNewDueDate, transactionId], (uErr) => {
            if (uErr) return res.json({ status: 'Error', message: uErr.message });

            db.query(`INSERT INTO rental_renewals
                      (transaction_id, renewed_date, old_due_date, new_due_date, renewed_by)
                      VALUES (?, CURDATE(), ?, ?, 'member')`,
                [transactionId, rental.due_date, formattedNewDueDate],
                (hErr) => { if (hErr) console.error('Error inserting renewal history:', hErr); });

            res.json({
                status: 'Success',
                message: `Book renewed successfully! New due date: ${formattedNewDueDate}`,
                data: {
                    transactionId,
                    oldDueDate: rental.due_date,
                    newDueDate: formattedNewDueDate,
                    renewedCount: (rental.renewed_count || 0) + 1
                }
            });
        });
    });
});

// History
app.get('/api/local/rentals/history/:memberId', (req, res) => {
    const { memberId } = req.params;
    const sql = `SELECT r.transaction_id AS transactionId,
                        r.book_id AS bookId,
                        r.book_title AS bookTitle,
                        DATE_FORMAT(r.borrowed_date, '%Y-%m-%d') AS borrowedDate,
                        DATE_FORMAT(r.due_date, '%Y-%m-%d') AS dueDate,
                        DATE_FORMAT(r.actual_return_date, '%Y-%m-%d') AS actualReturnDate,
                        r.rental_status_description AS status,
                        r.renewed_count AS renewedCount,
                        DATE_FORMAT(r.last_renewed_date, '%Y-%m-%d') AS lastRenewedDate,
                        DATE_FORMAT(r.renewed_due_date, '%Y-%m-%d') AS renewedDueDate
                 FROM rental_transactions r
                 WHERE r.member_id = ?
                 ORDER BY r.transaction_id DESC`;
    db.query(sql, [memberId], (err, results) => {
        if (err) return res.json({ status: 'Error', message: err.message, data: [] });
        res.json({ status: 'Success', message: 'Rental history retrieved', data: results });
    });
});

// Renewal history
app.get('/api/local/rentals/renewal-history/:transactionId', (req, res) => {
    const { transactionId } = req.params;
    const sql = `SELECT renewal_id AS renewalId,
                        transaction_id AS transactionId,
                        DATE_FORMAT(renewed_date, '%Y-%m-%d') AS renewedDate,
                        DATE_FORMAT(old_due_date, '%Y-%m-%d') AS oldDueDate,
                        DATE_FORMAT(new_due_date, '%Y-%m-%d') AS newDueDate,
                        renewed_by AS renewedBy,
                        created_at AS createdAt
                 FROM rental_renewals
                 WHERE transaction_id = ?
                 ORDER BY renewal_id DESC`;
    db.query(sql, [transactionId], (err, results) => {
        if (err) return res.json({ status: 'Error', message: err.message, data: [] });
        res.json({ status: 'Success', message: 'Renewal history retrieved', data: results });
    });
});

// Stats
app.get('/api/local/rentals/stats/:memberId', (req, res) => {
    const { memberId } = req.params;
    const sql = `SELECT
                    COUNT(CASE WHEN actual_return_date IS NULL AND due_date >= CURDATE() THEN 1 END) AS currentlyBorrowed,
                    COUNT(CASE WHEN actual_return_date IS NULL AND due_date <  CURDATE() THEN 1 END) AS overdueCount,
                    COUNT(CASE WHEN renewed_count > 0 THEN 1 END) AS renewedCount,
                    COUNT(*) AS totalRentals
                 FROM rental_transactions
                 WHERE member_id = ?`;
    db.query(sql, [memberId], (err, results) => {
        if (err) return res.json({ status: 'Error', message: err.message });
        res.json({
            status: 'Success',
            data: results[0] || { currentlyBorrowed: 0, overdueCount: 0, renewedCount: 0, totalRentals: 0 }
        });
    });
});

// Overdue (admin) — FIXED JOIN
app.get('/api/local/rentals/overdue', (req, res) => {
    const sql = `SELECT r.*,
                        m.member_first_name AS memberFirstName,
                        m.member_last_name  AS memberLastName,
                        b.price,
                        b.title AS book_title
                 FROM rental_transactions r
                 LEFT JOIN members m ON r.member_id = m.member_id
                 LEFT JOIN books   b ON r.book_id   = b.book_id
                 WHERE r.actual_return_date IS NULL
                   AND r.due_date < CURDATE()
                 ORDER BY r.due_date ASC`;
    db.query(sql, (err, results) => {
        if (err) return res.json({ status: 'Error', message: err.message });

        const overdueWithPenalty = results.map(r => {
            const today = new Date();
            const dueDate = new Date(r.due_date);
            const daysOverdue = Math.ceil((today - dueDate) / 86400000);
            const dailyPenalty = (r.price || 0) * 0.1;
            const totalPenalty = Math.min(dailyPenalty * daysOverdue, (r.price || 0) * 2);
            return {
                ...r,
                daysOverdue,
                dailyPenalty,
                totalPenalty: Math.round(totalPenalty * 100) / 100
            };
        });

        res.json({
            status: 'Success',
            message: `Found ${overdueWithPenalty.length} overdue rentals`,
            data: overdueWithPenalty
        });
    });
});

// Calculate penalty
app.get('/api/local/rentals/calculate-penalty/:transactionId', (req, res) => {
    const { transactionId } = req.params;
    const sql = `SELECT r.*, b.price, b.title
                 FROM rental_transactions r
                 LEFT JOIN books b ON r.book_id = b.book_id
                 WHERE r.transaction_id = ?`;
    db.query(sql, [transactionId], (err, results) => {
        if (err || results.length === 0)
            return res.json({ status: 'Error', message: 'Rental not found' });

        const rental = results[0];
        const today = new Date();
        const dueDate = new Date(rental.due_date);

        if (today <= dueDate) {
            return res.json({
                status: 'Success',
                message: 'Book is not overdue',
                data: { isOverdue: false, penaltyAmount: 0, daysOverdue: 0 }
            });
        }

        const daysOverdue = Math.ceil((today - dueDate) / 86400000);
        const dailyPenalty = (rental.price || 0) * 0.1;
        const totalPenalty = Math.min(dailyPenalty * daysOverdue, (rental.price || 0) * 2);

        res.json({
            status: 'Success',
            message: `Book is overdue by ${daysOverdue} days`,
            data: {
                isOverdue: true,
                daysOverdue,
                dailyPenalty,
                penaltyAmount: Math.round(totalPenalty * 100) / 100,
                dueDate: rental.due_date,
                bookPrice: rental.price
            }
        });
    });
});

// All rentals (admin)
app.get('/api/local/rentals/all/:memberId', (req, res) => {
    const { memberId } = req.params;

    const hasMember = memberId && memberId !== '0';
    const sql = `SELECT transaction_id AS transactionId,
                        member_id AS memberId,
                        book_id AS bookId,
                        book_title AS bookTitle,
                        DATE_FORMAT(borrowed_date, '%Y-%m-%d') AS borrowedDate,
                        DATE_FORMAT(due_date, '%Y-%m-%d') AS dueDate,
                        DATE_FORMAT(actual_return_date, '%Y-%m-%d') AS actualReturnDate,
                        rental_status_description AS rentalStatusDescription,
                        renewed_count AS renewedCount,
                        last_renewed_date AS lastRenewedDate,
                        renewed_due_date AS renewedDueDate
                 FROM rental_transactions
                 ${hasMember ? 'WHERE member_id = ?' : ''}
                 ORDER BY transaction_id DESC`;

    db.query(sql, hasMember ? [memberId] : [], (err, results) => {
        if (err) return res.json({ status: 'Error', message: err.message, data: [] });
        res.json({ status: 'Success', message: 'All rentals retrieved successfully', data: results });
    });
});

// ============================================================
//  PURCHASES
// ============================================================

app.post('/api/purchases/add', (req, res) => {
    const { memberId, bookId, title, author, price, purchaseDate } = req.body;
    db.query(
        `INSERT INTO purchases (member_id, book_id, title, author, price, purchase_date) VALUES (?, ?, ?, ?, ?, ?)`,
        [memberId, bookId, title, author, price, purchaseDate],
        (err, result) => {
            if (err) return res.json({ status: 'Error', message: err.message });
            res.json({ status: 'Success', message: 'Book purchased successfully!', data: { purchaseId: result.insertId } });
        });
});

// ============================================================
//  MEMBER PROXY (Company API)
// ============================================================

app.post('/api/members/save', async (req, res) => {
    try {
        const data = await makeRequest(`${COMPANY_API}/members/save`, req.body, 'POST');
        res.json(data);
    } catch (error) {
        res.status(500).json({ status: 'Error', message: error.message });
    }
});

// ============================================================
//  AUTH — Users
// ============================================================

app.post('/api/auth/register', (req, res) => {
    const { name, email, password } = req.body;
    if (!name || !email || !password)
        return res.status(400).json({ status: 'Error', message: 'All fields are required' });

    const hashedPassword = Buffer.from(password).toString('base64');
    db.query(`INSERT INTO users (name, email, password) VALUES (?, ?, ?)`,
        [name, email, hashedPassword],
        (err, result) => {
            if (err) {
                if (err.code === 'ER_DUP_ENTRY')
                    return res.json({ status: 'Error', message: 'Email already registered' });
                return res.json({ status: 'Error', message: err.message });
            }
            res.json({ status: 'Success', message: 'User registered successfully',
                data: { userId: result.insertId, name, email } });
        });
});

app.post('/api/auth/login', (req, res) => {
    const { email, password } = req.body;
    if (!email || !password)
        return res.status(400).json({ status: 'Error', message: 'Email and password are required' });

    const hashedPassword = Buffer.from(password).toString('base64');
    db.query(`SELECT user_id, name, email FROM users WHERE email = ? AND password = ?`,
        [email, hashedPassword],
        (err, results) => {
            if (err) return res.json({ status: 'Error', message: err.message });
            if (results.length === 0) return res.json({ status: 'Error', message: 'Invalid email or password' });
            const user = results[0];
            res.json({ status: 'Success', message: 'Login successful',
                data: { userId: user.user_id, name: user.name, email: user.email } });
        });
});

// ============================================================
//  AUTH — Admin
// ============================================================

app.post('/api/auth/create-default-admin', (req, res) => {
    const defaultAdmin = {
        name: 'Administrator',
        email: 'admin@gmail.com',
        password: 'admin12345'
    };
    const hashedPassword = Buffer.from(defaultAdmin.password).toString('base64');

    db.query(`SELECT * FROM admin_users WHERE email = ?`, [defaultAdmin.email], (err, results) => {
        if (err) return res.json({ status: 'Error', message: err.message });
        if (results.length > 0) return res.json({ status: 'Success', message: 'Admin already exists' });

        db.query(`INSERT INTO admin_users (name, email, password) VALUES (?, ?, ?)`,
            [defaultAdmin.name, defaultAdmin.email, hashedPassword],
            (err2) => {
                if (err2) return res.json({ status: 'Error', message: err2.message });
                res.json({
                    status: 'Success',
                    message: 'Default admin created successfully',
                    data: { email: defaultAdmin.email, password: defaultAdmin.password }
                });
            });
    });
});

app.post('/api/auth/admin-login', (req, res) => {
    const { email, password } = req.body;
    if (!email || !password)
        return res.status(400).json({ status: 'Error', message: 'Email and password are required' });

    const hashedPassword = Buffer.from(password).toString('base64');
    db.query(`SELECT admin_id, name, email FROM admin_users WHERE email = ? AND password = ?`,
        [email, hashedPassword],
        (err, results) => {
            if (err) return res.json({ status: 'Error', message: err.message });
            if (results.length === 0) return res.json({ status: 'Error', message: 'Invalid email or password' });
            const admin = results[0];
            res.json({ status: 'Success', message: 'Login successful',
                data: { adminId: admin.admin_id, name: admin.name, email: admin.email } });
        });
});

// ============================================================
//  HEALTH
// ============================================================

app.get('/api/health', (req, res) => {
    res.json({
        status: 'OK',
        timestamp: new Date().toISOString(),
        message: 'Backend server is running!',
        database: 'Connected'
    });
});

// ============================================================
//  START SERVER
// ============================================================

const PORT = process.env.PORT || 8080;
app.listen(PORT, '0.0.0.0', () => {
    console.log(`\n🚀 Backend server running on port ${PORT}`);
    console.log(`✅ Connected to MySQL database\n`);
});