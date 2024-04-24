"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
    __setModuleDefault(result, mod);
    return result;
};
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const mongoose_1 = __importDefault(require("mongoose"));
const ethers_1 = require("ethers");
const dotenv_1 = __importDefault(require("dotenv"));
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
const cors_1 = __importDefault(require("cors"));
const aws_sdk_1 = __importDefault(require("aws-sdk"));
const morgan_1 = __importDefault(require("morgan"));
const multer_1 = __importDefault(require("multer"));
// import { v4 as uuidv4 } from "uuid";
// import path from "path";
const schemas_1 = require("./schemas");
const utils_1 = require("./utils");
const share_1 = __importStar(require("./schemas/share"));
dotenv_1.default.config();
const app = (0, express_1.default)();
const port = process.env.PORT || 6900;
app.use((0, cors_1.default)({
    origin: [
        "http://localhost:5173",
        "http://localhost:6900",
        // "https://rollover.co.nz",
        // "https://admin.rollover.co.nz",
    ],
    credentials: true,
    allowedHeaders: [
        "Origin",
        "X-Requested-With",
        "Content-Type",
        "Accept",
        "Authorization",
    ],
    methods: ["GET", "PUT", "POST", "PATCH", "DELETE", "OPTIONS"],
}));
// app.use(helmet());
app.use((0, morgan_1.default)("dev"));
app.use(express_1.default.json());
app.use(express_1.default.static("/public"));
app.use(express_1.default.urlencoded({ extended: true }));
app.use("/uploads", express_1.default.static("uploads"));
aws_sdk_1.default.config.update({
    accessKeyId: process.env.AWS_S3_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_S3_SECRET_ACCESS_KEY,
    region: "eu-north-1",
});
const s3 = new aws_sdk_1.default.S3();
// Define the middleware function to verify JWT token
function Auth(req, res, next) {
    var _a;
    // Get the token from the request headers
    const [token1, token2] = ((_a = req.headers["authorization"]) === null || _a === void 0 ? void 0 : _a.split(" ")) || [];
    const token = token2 || token1;
    // Check if token is provided
    if (!token)
        return res.status(401).json({ message: "No token provided" });
    jsonwebtoken_1.default.verify(token, String(process.env.JWT_SECRET), (err, decoded) => __awaiter(this, void 0, void 0, function* () {
        if (err)
            return res.status(401).json({ message: "Invalid token" });
        if (!decoded)
            return res.status(401).json({ message: "Invalid token" });
        const user = yield schemas_1.UserModel.findById(decoded.id).lean();
        if (!user)
            return res.status(401).json({ message: "Invalid user" });
        req.user = decoded;
        next();
    }));
}
function PartialAuth(req, res, next) {
    var _a;
    // Get the token from the request headers
    const [token1, token2] = ((_a = req.headers["authorization"]) === null || _a === void 0 ? void 0 : _a.split(" ")) || [];
    const token = token2 || token1;
    // Check if token is provided
    if (!token)
        return next();
    jsonwebtoken_1.default.verify(token, String(process.env.JWT_SECRET), (err, decoded) => __awaiter(this, void 0, void 0, function* () {
        if (err)
            return res.status(401).json({ message: "Invalid token" });
        if (!decoded)
            return res.status(401).json({ message: "Invalid token" });
        const user = yield schemas_1.UserModel.findById(decoded.id).lean();
        if (!user)
            return res.status(401).json({ message: "Invalid user" });
        req.user = decoded;
        next();
    }));
}
const parseSort = (sortString) => {
    const sortByMap = {
        rec: "created_at",
        top: "upvotes",
        rand: "shares",
    };
    if (sortString == "null") {
        return {
            by: sortByMap.rec,
            order: -1,
        };
    }
    const [sortBy = "", sortOrder = ""] = sortString.split("-");
    const direction = sortOrder.toLocaleLowerCase() === "desc" ? -1 : 1;
    return {
        by: sortByMap[sortBy.toLocaleLowerCase()],
        order: direction,
    };
};
const parseSince = (since) => {
    if (!since)
        return null;
    const sinceMap = {
        "1h": new Date(Date.now() - 1 * 60 * 60 * 1000), // One hour in milliseconds
        "6h": new Date(Date.now() - 6 * 60 * 60 * 1000),
        "24h": new Date(Date.now() - 24 * 60 * 60 * 1000),
        "7d": new Date(Date.now() - 7 * 24 * 60 * 60 * 1000),
    };
    return sinceMap[since] || null;
};
const upload = (0, multer_1.default)({
    limits: {
        fileSize: 100 * 1024 * 1024, // 100mb max file size
    },
    fileFilter: (req, file, cb) => {
        const mime_types = ["video/webm", "video/x-msvideo", "video/mp4"];
        if (mime_types.includes(file.mimetype)) {
            cb(null, true);
        }
        else {
            cb(new Error("Unsupported file type"));
        }
    },
    storage: multer_1.default.memoryStorage(),
    // storage: multer.diskStorage({
    //   destination: (req, file, cb) => {
    //     cb(null, "uploads");
    //   },
    //   filename: (req, file, cb) => {
    //     const filename = uuidv4() + path.extname(file.originalname);
    //     cb(null, filename);
    //   },
    // }),
});
app.use("/ping", Auth, (req, res) => {
    res.send(`Hello! ${req.user.address}`);
});
app.post("/auth", (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        // veryify signature
        const { message, signature, signerAddress } = req.body;
        // Verify the signature
        const recoveredAddress = ethers_1.ethers.verifyMessage(message, signature);
        // Compare the recovered address with the expected signer address
        if (recoveredAddress.toLowerCase() !== signerAddress.toLowerCase())
            throw new utils_1.UnauthorizedError("Signature is invalid");
        // check if user already exist
        let user = yield schemas_1.UserModel.findOne({ address: recoveredAddress }).exec();
        if (!user) {
            const newUser = new schemas_1.UserModel({
                address: recoveredAddress,
            });
            user = yield newUser.save();
        }
        // generate token for user
        const token = jsonwebtoken_1.default.sign({ id: user._id, address: user.address }, String(process.env.JWT_SECRET), { expiresIn: "90h" });
        res.send({
            success: true,
            message: "Signin successful",
            data: {
                address: recoveredAddress,
                access_token: token,
            },
        });
    }
    catch (error) {
        console.error(error);
        res.status(500).json({ message: `${error}` });
    }
}));
// TODO: use transaction
// delete file after upload to s3 or failed upload
app.post("/post", Auth, upload.single("media"), (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a, _b;
    if (!req.file)
        return res.send("No file uploaded");
    console.log(req.file);
    try {
        const params = {
            Bucket: "bitcast/media",
            Key: (_a = req.file) === null || _a === void 0 ? void 0 : _a.originalname,
            Body: (_b = req.file) === null || _b === void 0 ? void 0 : _b.buffer,
        };
        s3.upload(params, (err, data) => __awaiter(void 0, void 0, void 0, function* () {
            if (err) {
                console.error(err);
                return res.status(500).send("Error uploading file");
            }
            console.log(data);
            // Update topic count or create topic
            const topic = yield schemas_1.TopicModel.findOneAndUpdate({ title: req.body.topic }, {
                $inc: { posts: 1 },
            }, { new: true, upsert: true }).exec();
            const newPost = new schemas_1.PostModel({
                topic_id: topic._id,
                author_id: req.user.id,
                caption: req.body.caption,
                media_url: data.Location,
                tiktok: `https://${req.body.tiktok.split("//").pop()}`,
                media_source: schemas_1.MediaSource.UPLOAD,
            });
            const savedPost = yield newPost.save();
            res.send({
                success: true,
                message: "Post created",
                data: {
                    _id: savedPost._id,
                },
            });
        }));
    }
    catch (error) {
        console.error(error);
        res.status(500).json({ message: `${error}` });
    }
}));
app.get("/post", PartialAuth, (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { page = 1, limit = 20, sort, since, topic, author } = req.query;
        const skip = (Number(page) - 1) * Number(limit);
        const sinceData = parseSince(String(since));
        const sortData = parseSort(String(sort || null));
        const query = Object.assign(Object.assign(Object.assign({}, (topic && { topic_id: topic })), (author && { author_id: author })), (sinceData && { created_at: { $gt: sinceData } }));
        console.log("sort => ", { [String(sortData.by)]: sortData.order });
        console.log("query => ", query);
        const getPosts = schemas_1.PostModel.find(query)
            .sort({ [String(sortData.by)]: sortData.order })
            .skip(skip)
            .limit(Number(limit))
            .populate("topic_id author_id");
        const getPostsCount = schemas_1.PostModel.countDocuments(query).countDocuments();
        let [docs, totalCount] = yield Promise.all([
            getPosts.lean().exec(),
            getPostsCount,
        ]);
        const totalPages = Math.ceil(totalCount / Number(limit));
        if (req.user !== undefined) {
            const votes = yield schemas_1.VoteModel.find({
                user_id: req.user.id,
                post_id: {
                    $in: docs.map((x) => x._id),
                },
            })
                .lean()
                .exec();
            // Post with votes
            docs = docs.map((doc) => {
                const vote = votes.filter((el) => String(el.post_id) === String(doc._id))[0];
                return Object.assign(Object.assign(Object.assign({}, doc), (vote && vote.type == schemas_1.VoteType.UPVOTE && { upvoted: true })), (vote && vote.type == schemas_1.VoteType.DOWNVOTE && { downvoted: true }));
            });
        }
        // TODO: show if user have votes while sending result
        res.send({
            success: true,
            message: "",
            data: {
                docs,
                meta: {
                    page,
                    limit,
                    total_count: totalCount,
                    total_pages: totalPages,
                },
            },
        });
    }
    catch (error) {
        console.error(error);
        res.status(500).json({ message: `${error}` });
    }
}));
app.get("/post/:id", PartialAuth, (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const post = yield schemas_1.PostModel.findById(req.params.id)
            .select("-__v -media_source")
            .populate({
            path: "topic_id",
            model: "Topic",
            select: "title",
        });
        if (!post) {
            return res.status(404).json({ message: "Post not found" });
        }
        res.send({
            success: true,
            message: "",
            data: post,
        });
    }
    catch (error) {
        console.error(error);
        res.status(500).json({ message: `${error}` });
    }
}));
// TODO: use transaction
app.patch("/post/:id/upvote", Auth, (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const userId = req.user.id;
        const postId = req.params.id;
        // check the Vote shcema to see if the person has upvoted the post before, if yes return
        let vote = yield schemas_1.VoteModel.findOne({ user_id: userId, post_id: postId });
        if (vote && vote.type == schemas_1.VoteType.UPVOTE)
            throw new utils_1.BadRequestError("You've already upvoted this post");
        // if downvoted, delete
        if (vote && vote.type == schemas_1.VoteType.DOWNVOTE) {
            yield schemas_1.VoteModel.findByIdAndDelete(vote._id);
            yield schemas_1.PostModel.findByIdAndUpdate(postId, { $inc: { downvotes: -1 } }, { new: true });
        }
        const newVote = new schemas_1.VoteModel({
            user_id: userId,
            post_id: postId,
            type: schemas_1.VoteType.UPVOTE,
        });
        yield newVote.save();
        // check if it was shared and inc upvote the share schema by {post_id, sharerer_id, medium}
        // keep share id
        const updatedPost = yield schemas_1.PostModel.findByIdAndUpdate(postId, { $inc: { upvotes: 1 } }, { new: true });
        if (!updatedPost)
            return res.status(404).json({ message: "Post not found" });
        res.send({
            success: true,
            message: "Post upvoted",
            data: {},
        });
    }
    catch (error) {
        console.error(error);
        res.status(500).json({ message: `${error}` });
    }
}));
// TODO: use transaction
app.patch("/post/:id/downvote", Auth, (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const userId = req.user.id;
        const postId = req.params.id;
        // check the Vote shcema to see if the person has upvoted the post before, if yes return
        let vote = yield schemas_1.VoteModel.findOne({ user_id: userId, post_id: postId });
        if (vote && vote.type == schemas_1.VoteType.DOWNVOTE)
            throw new utils_1.BadRequestError("You've already downvoted this post");
        // if downvoted, delete
        if (vote && vote.type == schemas_1.VoteType.UPVOTE) {
            yield schemas_1.VoteModel.findByIdAndDelete(vote._id);
            yield schemas_1.PostModel.findByIdAndUpdate(postId, { $inc: { upvotes: -1 } }, { new: true });
        }
        const newVote = new schemas_1.VoteModel({
            user_id: userId,
            post_id: postId,
            type: schemas_1.VoteType.DOWNVOTE,
        });
        yield newVote.save();
        // check if it was shared and inc upvote the share schema by {post_id, sharerer_id, medium}
        // keep share id
        const updatedPost = yield schemas_1.PostModel.findByIdAndUpdate(postId, { $inc: { downvotes: 1 } }, { new: true });
        if (!updatedPost)
            return res.status(404).json({ message: "Post not found" });
        res.send({
            success: true,
            message: "Post downvoted",
            data: {},
        });
    }
    catch (error) {
        console.error(error);
        res.status(500).json({ message: `${error}` });
    }
}));
app.patch("/post/:id/unvote", Auth, (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const userId = req.user.id;
        const postId = req.params.id;
        // check vote schema to see if user has vote
        let vote = yield schemas_1.VoteModel.findOneAndDelete({
            user_id: userId,
            post_id: postId,
        });
        if (!vote)
            throw new utils_1.BadRequestError("You've already unvoted this post");
        // decrement post upvote or downvote
        yield schemas_1.PostModel.findByIdAndUpdate(postId, {
            $inc: vote.type == schemas_1.VoteType.UPVOTE ? { upvotes: -1 } : { downvotes: -1 },
        }, { new: true });
        res.send({
            success: true,
            message: "Post unvoted",
            data: {},
        });
    }
    catch (error) {
        console.error(error);
        res.status(500).json({ message: `${error}` });
    }
}));
// when a post loads it hits this endpoint
app.post("/share", Auth, (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        // m - Medium
        // s- sharerer id
        // p - post id
        const { m, s, p } = req.body;
        const user = yield schemas_1.UserModel.findById(s);
        if (!user)
            return;
        const post = yield schemas_1.PostModel.findById(p);
        if (!post)
            return;
        // create record if it doesnt exist and increase click count
        yield share_1.default.findOneAndUpdate({
            post_id: p,
            sharerer_id: s,
            medium: Object.values(share_1.ShareMedium).includes(m)
                ? m
                : share_1.ShareMedium.GENERIC,
        }, {
            $inc: { clicks: 1 },
        }, {
            new: true,
            upsert: true,
        });
        res.send({
            success: true,
            message: "",
            data: {},
        });
    }
    catch (error) {
        console.error(error);
        res.status(500).json({ message: `${error}` });
    }
}));
app.listen(port, () => __awaiter(void 0, void 0, void 0, function* () {
    const connectDB = () => __awaiter(void 0, void 0, void 0, function* () {
        try {
            yield mongoose_1.default.connect(String(process.env.MONGODB_URI));
            console.log("[MongoDB] Connected successfully!");
        }
        catch (error) {
            console.error("[MongoDB] Error connecting: ", error);
            process.exit(1);
        }
    });
    yield connectDB();
    console.log(`[server]: Server is running at http://localhost:${port}`);
}));