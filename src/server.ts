import express, {
  Errback,
  Express,
  NextFunction,
  Request,
  Response,
} from "express";
import mongoose, { SortOrder } from "mongoose";
import { ethers } from "ethers";
import dotenv from "dotenv";
import jwt from "jsonwebtoken";
import cors from "cors";
import AWS from "aws-sdk";
import morgan from "morgan";
import multer from "multer";
// import { v4 as uuidv4 } from "uuid";
// import path from "path";

import {
  MediaSource,
  PostModel,
  UserModel,
  VoteModel,
  TopicModel,
  VoteType,
  AuthRequest,
  Post,
} from "./schemas";
import {
  BadRequestError,
  NotFoundError,
  UnauthorizedError,
  httpErrorHandler,
  parseSince,
} from "./utils";
import { AuthUser } from "..";
import { ShareModel, ShareMedium } from "./schemas/share";

dotenv.config();

const app: Express = express();
const port = process.env.PORT || 6900;

app.use(
  cors({
    origin: [
      "https://bitcast-client.vercel.app",
      "https://bitcast-backend.onrender.com",
      "http://localhost:5173",
      "http://localhost:6900",
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
  })
);
// app.use(helmet());
app.use(morgan("dev"));
app.use(express.json());
app.use(express.static("/public"));
app.use(express.urlencoded({ extended: true }));
app.use("/uploads", express.static("uploads"));

AWS.config.update({
  accessKeyId: process.env.AWS_S3_ACCESS_KEY_ID,
  secretAccessKey: process.env.AWS_S3_SECRET_ACCESS_KEY,
  region: "eu-north-1",
});

const s3 = new AWS.S3();

// Define the middleware function to verify JWT token
function Auth(req: AuthRequest, res: Response, next: NextFunction) {
  // Get the token from the request headers
  const [token1, token2] = req.headers["authorization"]?.split(" ") || [];
  const token = token2 || token1;

  // Check if token is provided
  if (!token) throw new UnauthorizedError("No token provided");

  jwt.verify(token, String(process.env.JWT_SECRET), async (err, decoded) => {
    if (err) throw new UnauthorizedError("Invalid token");
    if (!decoded) throw new UnauthorizedError("Invalid token");

    const user = await UserModel.findById((decoded as any).id).lean();

    if (!user) throw new UnauthorizedError("Invalid user");

    req.user = decoded as AuthUser;
    next();
  });
}

function PartialAuth(req: AuthRequest, res: Response, next: NextFunction) {
  // Get the token from the request headers
  const [token1, token2] = req.headers["authorization"]?.split(" ") || [];
  const token = token2 || token1;

  // Check if token is provided
  if (!token) return next();

  jwt.verify(token, String(process.env.JWT_SECRET), async (err, decoded) => {
    if (err) throw new UnauthorizedError("Invalid token");
    if (!decoded) throw new UnauthorizedError("Invalid token");

    const user = await UserModel.findById((decoded as any).id).lean();

    if (!user) throw new UnauthorizedError("Invalid user");

    req.user = decoded as AuthUser;
    next();
  });
}

const parseSort = (
  sortBy: string,
  sortOrder: string
): { by: string; order: -1 | 1 } => {
  const sortByMap = {
    rec: "created_at",
    top: "upvotes",
    rand: "shares",
  } as { [x: string]: string };

  if (sortBy == "null") {
    return {
      by: sortByMap.rec,
      order: -1,
    };
  }

  const direction = sortOrder.toLocaleLowerCase() === "desc" ? -1 : 1;

  return {
    by: sortByMap[sortBy.toLocaleLowerCase()],
    order: direction,
  };
};

const uploadFile = (fieldName: string) => {
  return (req: AuthRequest, res: Response, next: NextFunction) => {
    upload.single(fieldName)(req, res, (error) => {
      if (error) return next(error);
      next();
    });
  };
};

const upload = multer({
  limits: {
    fileSize: 100 * 1024 * 1024, // 100mb max file size
  },
  fileFilter: (_req, file, cb) => {
    const mime_types = [
      "video/webm",
      "video/x-msvideo",
      "video/mp4",
      "video/quicktime",
      "video/x-msvideo",
      "video/x-ms-wmv",
    ];
    if (mime_types.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new BadRequestError("Unsupported file type"));
    }
  },
  storage: multer.memoryStorage(),
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

app.use(
  "/ping",
  Auth,
  (req: AuthRequest, res: Response, next: NextFunction) => {
    res.send(`Hello! ${req.user.address}`);
  }
);

app.post(
  "/auth",
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    interface SigninMessage {
      message: string;
      signature: string;
      signerAddress: string;
    }

    try {
      // veryify signature
      const { message, signature, signerAddress }: SigninMessage = req.body;

      // Verify the signature
      const recoveredAddress = ethers.verifyMessage(message, signature);

      // Compare the recovered address with the expected signer address
      if (recoveredAddress.toLowerCase() !== signerAddress.toLowerCase())
        throw new UnauthorizedError("Signature is invalid");

      // check if user already exist
      let user = await UserModel.findOne({ address: recoveredAddress }).exec();
      if (!user) {
        const newUser = new UserModel({
          address: recoveredAddress,
        });
        user = await newUser.save();
      }

      // generate token for user
      const token = jwt.sign(
        { id: user._id, address: user.address },
        String(process.env.JWT_SECRET)
      );

      res.send({
        success: true,
        message: "Signin successful",
        data: {
          address: recoveredAddress,
          access_token: token,
        },
      });
    } catch (error) {
      next(error);
    }
  }
);

// TODO: use transaction
// delete file after upload to s3 or failed upload
app.post(
  "/post",
  Auth,
  uploadFile("media"),
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      if (!req.file) throw new BadRequestError("No file uploaded");

      const params: AWS.S3.PutObjectRequest = {
        Bucket: "bitcast/media",
        Key: req.file?.originalname,
        Body: req.file?.buffer,
      };

      s3.upload(params, async (err: unknown, data: any) => {
        if (err) throw err;

        // Update topic count or create topic
        const topic = await TopicModel.findOneAndUpdate(
          { title: req.body.topic },
          {
            $inc: { posts: 1 },
          },
          { new: true, upsert: true }
        ).exec();

        const newPost = new PostModel({
          topic_id: topic._id,
          author_id: req.user.id,
          caption: req.body.caption,
          media_url: data.Location,
          tiktok: `https://${req.body.tiktok.split("//").pop()}`,
          media_source: MediaSource.UPLOAD,
        });
        const savedPost = await newPost.save();

        res.send({
          success: true,
          message: "Post created",
          data: {
            _id: savedPost._id,
          },
        });
      });
    } catch (error) {
      next(error);
    }
  }
);

app.get(
  "/post",
  PartialAuth,
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const {
        page = 1,
        limit = 20,
        sort,
        order,
        since,
        topic,
        author,
      } = req.query;
      const skip = (Number(page) - 1) * Number(limit);

      const sortData = parseSort(String(sort), String(order));
      const sinceData = parseSince(String(since));

      const query = {
        ...(topic && { topic_id: new mongoose.Types.ObjectId(String(topic)) }),
        ...(author && {
          author_id: new mongoose.Types.ObjectId(String(author)),
        }),
        ...(sinceData && { created_at: { $gte: sinceData } }),
      };

      const sortObj = { [String(sortData.by)]: sortData.order };

      const getPosts = await PostModel.aggregate([
        {
          $match: query,
        },
        {
          $facet: {
            data: [
              // Sort stage to sort the orders by a field
              {
                $sort: sortObj,
              },
              // Skip stage to skip a certain number of documents
              {
                $skip: skip,
              },
              // Limit stage to limit the number of documents returned
              {
                $limit: Number(limit),
              },
              // Lookup stage to populate the product details
              {
                $lookup: {
                  from: "users", // Collection name to lookup
                  localField: "author_id", // Field in the current collection
                  foreignField: "_id", // Field in the foreign collection
                  as: "author", // Alias for the populated field
                },
              },
              {
                $lookup: {
                  from: "topics", // Collection name to lookup
                  localField: "topic_id", // Field in the current collection
                  foreignField: "_id", // Field in the foreign collection
                  as: "topic", // Alias for the populated field
                },
              },
              // Unwind stage to flatten the array of populated products
              {
                $unwind: "$topic",
              },
              {
                $unwind: "$author",
              },
              {
                $project: {
                  _id: 1,
                  upvotes: 1,
                  downvotes: 1,
                  shares: 1,
                  caption: 1,
                  media_url: 1,
                  tiktok: 1,
                  media_source: 1,
                  created_at: 1,
                  author: {
                    _id: 1,
                    address: 1,
                  },
                  topic: {
                    _id: 1,
                    title: 1,
                  },
                },
              },
            ],
            count: [{ $count: "total" }],
          },
        },
      ]);

      let { data, count } = getPosts[0];

      const totalCount = count[0]?.total || 0;

      const totalPages = Math.ceil(totalCount / Number(limit));

      if (req.user !== undefined) {
        const votes = await VoteModel.find({
          user_id: req.user.id,
          post_id: {
            $in: data.map((x: Post) => x._id),
          },
        })
          .lean()
          .exec();

        // Posts with votes
        data = data.map((doc: Post) => {
          const vote = votes.filter(
            (el) => String(el.post_id) === String(doc._id)
          )[0];

          return {
            ...doc,
            ...(vote && vote.type == VoteType.UPVOTE && { upvoted: true }),
            ...(vote && vote.type == VoteType.DOWNVOTE && { downvoted: true }),
          };
        });
      }

      res.send({
        success: true,
        message: "",
        data: {
          docs: data,
          meta: {
            page,
            limit,
            total_count: totalCount,
            total_pages: totalPages,
          },
        },
      });
    } catch (error) {
      next(error);
    }
  }
);

app.get(
  "/post/:id",
  PartialAuth,
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const post = await PostModel.findById(req.params.id)
        .select("-__v -media_source")
        .populate({
          path: "topic_id",
          model: "Topic",
          select: "title",
        });
      if (!post) {
        throw new NotFoundError("Post not found");
      }
      res.send({
        success: true,
        message: "",
        data: post,
      });
    } catch (error) {
      next(error);
    }
  }
);

// TODO: use transaction
app.patch(
  "/post/:id/upvote",
  Auth,
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const userId = req.user.id;
      const postId = req.params.id;

      // check the Vote shcema to see if the person has upvoted the post before, if yes return
      let vote = await VoteModel.findOne({ user_id: userId, post_id: postId });
      if (vote && vote.type == VoteType.UPVOTE)
        throw new BadRequestError("You've already upvoted this post");

      // if downvoted, delete
      if (vote && vote.type == VoteType.DOWNVOTE) {
        await VoteModel.findByIdAndDelete(vote._id);
        await PostModel.findByIdAndUpdate(
          postId,
          { $inc: { downvotes: -1 } },
          { new: true }
        );
      }

      const newVote = new VoteModel({
        user_id: userId,
        post_id: postId,
        type: VoteType.UPVOTE,
      });
      await newVote.save();

      // check if it was shared and inc upvote the share schema by {post_id, sharerer_id, medium}
      // keep share id
      const updatedPost = await PostModel.findByIdAndUpdate(
        postId,
        { $inc: { upvotes: 1 } },
        { new: true }
      );
      if (!updatedPost) throw new NotFoundError("Post not found");

      res.send({
        success: true,
        message: "Post upvoted",
        data: {},
      });
    } catch (error) {
      next(error);
    }
  }
);

// TODO: use transaction
app.patch(
  "/post/:id/downvote",
  Auth,
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const userId = req.user.id;
      const postId = req.params.id;

      // check the Vote shcema to see if the person has upvoted the post before, if yes return
      let vote = await VoteModel.findOne({ user_id: userId, post_id: postId });
      if (vote && vote.type == VoteType.DOWNVOTE)
        throw new BadRequestError("You've already downvoted this post");

      // if downvoted, delete
      if (vote && vote.type == VoteType.UPVOTE) {
        await VoteModel.findByIdAndDelete(vote._id);
        await PostModel.findByIdAndUpdate(
          postId,
          { $inc: { upvotes: -1 } },
          { new: true }
        );
      }

      const newVote = new VoteModel({
        user_id: userId,
        post_id: postId,
        type: VoteType.DOWNVOTE,
      });
      await newVote.save();

      // check if it was shared and inc upvote the share schema by {post_id, sharerer_id, medium}
      // keep share id
      const updatedPost = await PostModel.findByIdAndUpdate(
        postId,
        { $inc: { downvotes: 1 } },
        { new: true }
      );
      if (!updatedPost) throw new NotFoundError("Post not found");

      res.send({
        success: true,
        message: "Post downvoted",
        data: {},
      });
    } catch (error) {
      next(error);
    }
  }
);

app.patch(
  "/post/:id/unvote",
  Auth,
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const userId = req.user.id;
      const postId = req.params.id;

      // check vote schema to see if user has vote
      let vote = await VoteModel.findOneAndDelete({
        user_id: userId,
        post_id: postId,
      });
      if (!vote) throw new BadRequestError("You've already unvoted this post");

      // decrement post upvote or downvote
      await PostModel.findByIdAndUpdate(
        postId,
        {
          $inc:
            vote.type == VoteType.UPVOTE ? { upvotes: -1 } : { downvotes: -1 },
        },
        { new: true }
      );
      res.send({
        success: true,
        message: "Post unvoted",
        data: {},
      });
    } catch (error) {
      next(error);
    }
  }
);

// when a post loads it hits this endpoint
app.post(
  "/share",
  Auth,
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      // m - Medium
      // s- sharerer id
      // p - post id
      const { m, s, p } = req.body;

      const user = await UserModel.findById(s);
      if (!user) return;

      const post = await PostModel.findById(p);
      if (!post) return;

      // create record if it doesnt exist and increase click count
      await ShareModel.findOneAndUpdate(
        {
          post_id: p,
          sharerer_id: s,
          medium: Object.values(ShareMedium).includes(m)
            ? m
            : ShareMedium.GENERIC,
        },
        {
          $inc: { clicks: 1 },
        },
        {
          new: true,
          upsert: true,
        }
      );

      res.send({
        success: true,
        message: "",
        data: {},
      });
    } catch (error) {
      next(error);
    }
  }
);

app.use(httpErrorHandler);

app.listen(port, async () => {
  const connectDB = async () => {
    try {
      await mongoose.connect(String(process.env.MONGODB_URI));
      console.log("[MongoDB] Connected successfully!");
    } catch (error) {
      console.error("[MongoDB] Error connecting: ", error);
      process.exit(1);
    }
  };

  await connectDB();
  console.log(`[server]: Server is running at http://localhost:${port}`);
});
